// CRE fuel-price publication feeds. The old api.datos.gob.mx API is dead
// (times out); these XML feeds carry the same underlying CRE data.
const PRICES_URL = 'https://publicacionexterna.azurewebsites.net/publicaciones/prices'
const PLACES_URL = 'https://publicacionexterna.azurewebsites.net/publicaciones/places'

// The feeds have no state field — filter stations by CDMX bounding box.
const CDMX_BBOX = { latMin: 19.04, latMax: 19.6, lngMin: -99.37, lngMax: -98.93 }

// A healthy feed yields ~700 CDMX stations; far fewer means a broken feed
// whose median can't be trusted.
const MIN_SAMPLE = 50

const FETCH_TIMEOUT_MS = 30_000

const FUEL_FIELD: Record<'magna' | 'premium' | 'diesel', string> = {
  magna:   'regular',   // CRE feeds use 'regular' for Magna
  premium: 'premium',
  diesel:  'diesel',
}

type FuelType = 'magna' | 'premium' | 'diesel'

interface FetchedReading {
  source: 'cre_datos_gob'
  reading_type: 'fuel'
  value: Record<string, unknown>
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

async function fetchXml(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`CRE feed error: ${res.status}`)
  return res.text()
}

/** Iterate <place place_id="N">…</place> blocks. */
function* placeBlocks(xml: string): Generator<{ id: string; body: string }> {
  for (const m of xml.matchAll(/<place place_id="(\d+)">([\s\S]*?)<\/place>/g)) {
    yield { id: m[1], body: m[2] }
  }
}

function parseLocations(xml: string): Map<string, { lat: number; lng: number }> {
  const locations = new Map<string, { lat: number; lng: number }>()
  for (const { id, body } of placeBlocks(xml)) {
    const loc = body.match(/<x>(-?[\d.]+)<\/x>\s*<y>(-?[\d.]+)<\/y>/)
    if (!loc) continue
    const lng = parseFloat(loc[1])
    const lat = parseFloat(loc[2])
    if (isNaN(lat) || isNaN(lng)) continue
    locations.set(id, { lat, lng })
  }
  return locations
}

function parsePrices(xml: string, field: string): Map<string, number> {
  const prices = new Map<string, number>()
  const priceRe = new RegExp(`<gas_price type="${field}">([\\d.]+)</gas_price>`)
  for (const { id, body } of placeBlocks(xml)) {
    const m = body.match(priceRe)
    if (!m) continue
    const price = parseFloat(m[1])
    if (isNaN(price) || price <= 0) continue
    prices.set(id, price)
  }
  return prices
}

function inCdmx({ lat, lng }: { lat: number; lng: number }): boolean {
  return lat >= CDMX_BBOX.latMin && lat <= CDMX_BBOX.latMax
    && lng >= CDMX_BBOX.lngMin && lng <= CDMX_BBOX.lngMax
}

export async function fetchGasPrice(fuelType: FuelType): Promise<FetchedReading> {
  const [pricesXmlBody, placesXmlBody] = await Promise.all([
    fetchXml(PRICES_URL),
    fetchXml(PLACES_URL),
  ])

  const locations = parseLocations(placesXmlBody)
  const prices = parsePrices(pricesXmlBody, FUEL_FIELD[fuelType])

  const samples: number[] = []
  for (const [id, price] of prices) {
    const loc = locations.get(id)
    if (loc && inCdmx(loc)) samples.push(price)
  }

  if (samples.length < MIN_SAMPLE) {
    throw new Error(`CDMX sample too small for ${fuelType}: ${samples.length} < ${MIN_SAMPLE}`)
  }

  return {
    source: 'cre_datos_gob',
    reading_type: 'fuel',
    value: {
      price_mxn_per_liter: median(samples),
      fuel_type: fuelType,
      sample_size: samples.length,
    },
  }
}
