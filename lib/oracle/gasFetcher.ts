const BASE = 'https://api.datos.gob.mx/v1/precio.gasolina.publico'

const FUEL_FIELD: Record<'magna' | 'premium' | 'diesel', string> = {
  magna:   'regular',   // CRE API uses 'regular' for Magna
  premium: 'premium',
  diesel:  'diesel',
}

type FuelType = 'magna' | 'premium' | 'diesel'

interface StationRecord {
  estado: string
  [key: string]: string | null
}

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

export async function fetchGasPrice(fuelType: FuelType): Promise<FetchedReading> {
  const url = `${BASE}?pageSize=1000&estado=Ciudad%20de%20M%C3%A9xico`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`datos.gob.mx error: ${res.status}`)

  const data = await res.json() as { results: StationRecord[] }
  const field = FUEL_FIELD[fuelType]

  const prices = data.results
    .filter((r) => r.estado === 'Ciudad de México' && r[field] != null)
    .map((r) => parseFloat(r[field] as string))
    .filter((p) => !isNaN(p) && p > 0)

  if (prices.length === 0) throw new Error(`No CDMX price data for ${fuelType}`)

  const price = median(prices)

  return {
    source: 'cre_datos_gob',
    reading_type: 'fuel',
    value: { price_mxn_per_liter: price, fuel_type: fuelType, sample_size: prices.length },
  }
}
