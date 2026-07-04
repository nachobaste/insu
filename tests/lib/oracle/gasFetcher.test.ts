import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchGasPrice } from '@/lib/oracle/gasFetcher'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

interface Station {
  id: number
  lat: number
  lng: number
  regular?: number
  premium?: number
  diesel?: number
}

// Inside the CDMX bounding box (lat 19.04–19.60, lng −99.37 to −98.93)
const CDMX_COORDS = { lat: 19.4, lng: -99.15 }
// Outside the box (Guadalajara)
const GDL_COORDS = { lat: 20.67, lng: -103.35 }

/** n CDMX stations with regular prices 22.00, 22.01, … (median = 22.00 + (n-1)/2 * 0.01) */
function cdmxStations(n: number): Station[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    ...CDMX_COORDS,
    regular: 22.0 + i * 0.01,
    diesel: 26.0 + i * 0.01,
    ...(i % 2 === 0 ? { premium: 28.0 + i * 0.01 } : {}),
  }))
}

function pricesXml(stations: Station[]): string {
  const places = stations
    .map((s) => {
      const lines = (['regular', 'premium', 'diesel'] as const)
        .filter((f) => s[f] !== undefined)
        .map((f) => `    <gas_price type="${f}">${s[f]!.toFixed(2)}</gas_price>`)
        .join('\n')
      return `  <place place_id="${s.id}">\n${lines}\n  </place>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>\n<places>\n${places}\n</places>`
}

function placesXml(stations: Station[]): string {
  const places = stations
    .map(
      (s) =>
        `  <place place_id="${s.id}">\n    <name>STATION ${s.id}</name>\n    <cre_id>PL/${s.id}/EXP/ES/2015</cre_id>\n    <location>\n      <x>${s.lng}</x>\n      <y>${s.lat}</y>\n    </location>\n  </place>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>\n<places>\n${places}\n</places>`
}

/** Route the two feed URLs to XML bodies. */
function mockFeeds(stations: Station[]) {
  mockFetch.mockImplementation((url: string) => {
    const body = url.includes('/prices') ? pricesXml(stations) : placesXml(stations)
    return Promise.resolve({ ok: true, text: () => Promise.resolve(body) })
  })
}

describe('fetchGasPrice', () => {
  beforeEach(() => mockFetch.mockReset())

  it('fetches both CRE feed URLs', async () => {
    mockFeeds(cdmxStations(60))
    await fetchGasPrice('magna')
    const urls = mockFetch.mock.calls.map((c) => c[0] as string)
    expect(urls.some((u) => u.includes('publicacionexterna.azurewebsites.net/publicaciones/prices'))).toBe(true)
    expect(urls.some((u) => u.includes('publicacionexterna.azurewebsites.net/publicaciones/places'))).toBe(true)
  })

  it('returns the median Magna (regular) price with correct shape', async () => {
    mockFeeds(cdmxStations(61))
    const result = await fetchGasPrice('magna')
    // 61 stations, prices 22.00 … 22.60 → median = 22.30
    expect(result.value.price_mxn_per_liter).toBeCloseTo(22.3, 5)
    expect(result.source).toBe('cre_datos_gob')
    expect(result.reading_type).toBe('fuel')
    expect(result.value.fuel_type).toBe('magna')
    expect(result.value.sample_size).toBe(61)
  })

  it('excludes stations outside the CDMX bounding box', async () => {
    const outlier: Station = { id: 999, ...GDL_COORDS, regular: 99.0 }
    mockFeeds([...cdmxStations(61), outlier])
    const result = await fetchGasPrice('magna')
    expect(result.value.sample_size).toBe(61)
    expect(result.value.price_mxn_per_liter).toBeCloseTo(22.3, 5)
  })

  it('skips stations missing the requested fuel type', async () => {
    // premium exists only on even-index stations: 51 of 101 (still above MIN_SAMPLE)
    mockFeeds(cdmxStations(101))
    const result = await fetchGasPrice('premium')
    expect(result.value.sample_size).toBe(51)
  })

  it('throws when the CDMX sample is below the minimum', async () => {
    mockFeeds(cdmxStations(10))
    await expect(fetchGasPrice('magna')).rejects.toThrow(/sample too small/i)
  })

  it('throws when a feed returns non-ok status', async () => {
    mockFetch.mockImplementation(() => Promise.resolve({ ok: false, status: 503 }))
    await expect(fetchGasPrice('magna')).rejects.toThrow('CRE feed error: 503')
  })
})
