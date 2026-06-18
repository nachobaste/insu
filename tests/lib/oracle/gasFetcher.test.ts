import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchGasPrice } from '@/lib/oracle/gasFetcher'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const CDMX_STATIONS = [
  { estado: 'Ciudad de México', regular: '26.49', premium: '29.20', diesel: '25.80' },
  { estado: 'Ciudad de México', regular: '26.50', premium: '29.21', diesel: '25.81' },
  { estado: 'Ciudad de México', regular: '26.48', premium: null,    diesel: '25.79' },
  { estado: 'Jalisco',          regular: '99.00', premium: '99.00', diesel: '99.00' },
]

function mockResponse(results: typeof CDMX_STATIONS) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ results, pagination: { total: results.length } }),
  })
}

describe('fetchGasPrice', () => {
  beforeEach(() => mockFetch.mockReset())

  it('calls datos.gob.mx with the correct URL', async () => {
    mockResponse(CDMX_STATIONS)
    await fetchGasPrice('magna')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.datos.gob.mx'),
    )
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('Ciudad'),
    )
  })

  it('returns median Magna price for CDMX stations only', async () => {
    mockResponse(CDMX_STATIONS)
    const result = await fetchGasPrice('magna')
    // CDMX stations: [26.48, 26.49, 26.50] → median = 26.49
    expect(result.value.price_mxn_per_liter).toBe(26.49)
    expect(result.source).toBe('cre_datos_gob')
    expect(result.reading_type).toBe('fuel')
  })

  it('returns median Premium price, skipping null values', async () => {
    mockResponse(CDMX_STATIONS)
    const result = await fetchGasPrice('premium')
    // CDMX stations with non-null premium: [29.20, 29.21] → median = 29.205
    expect(result.value.price_mxn_per_liter).toBe(29.205)
  })

  it('returns median Diesel price', async () => {
    mockResponse(CDMX_STATIONS)
    const result = await fetchGasPrice('diesel')
    // CDMX diesel: [25.79, 25.80, 25.81] → median = 25.80
    expect(result.value.price_mxn_per_liter).toBe(25.80)
  })

  it('throws when no CDMX stations found for fuel type', async () => {
    mockResponse([{ estado: 'Jalisco', regular: '26.00', premium: '29.00', diesel: '25.00' }])
    await expect(fetchGasPrice('magna')).rejects.toThrow('No CDMX price data')
  })

  it('throws when fetch returns non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 })
    await expect(fetchGasPrice('magna')).rejects.toThrow('datos.gob.mx error: 503')
  })
})
