import { describe, it, expect, vi } from 'vitest'
import { pollContracts, ensureCorridorPolylines, POLLABLE_TRIGGER_TYPES } from '@/lib/oracle/poll'
import type { Contract } from '@/lib/types'

vi.mock('@/lib/oracle/gasFetcher', () => ({
  fetchGasPrice: vi.fn().mockResolvedValue({
    source: 'cre_datos_gob', reading_type: 'fuel',
    value: { price_mxn_per_liter: 24, fuel_type: 'magna', sample_size: 700 },
  }),
}))
vi.mock('@/lib/oracle/guatemalaFuelFetcher', () => ({
  fetchGuatemalaFuelPrice: vi.fn().mockResolvedValue({
    source: 'agn_mem', reading_type: 'fuel',
    value: { gas_price_quetzales: 40.09, fuel_type: 'regular', reference_week: '2026-07-21' },
  }),
}))

const mockContract: Contract = {
  id: 'c1',
  slug: 'rain-cdmx',
  title: 'Rain CDMX',
  description: null,
  category_id: 'cat-1',
  status: 'active',
  trigger_type: 'weather',
  trigger_condition: { metric: 'rain_mm', threshold: 10, operator: 'gte' },
  trigger_deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  is_recurring: false,
  location: { lat: 19.4, lng: -99.1, city: 'CDMX', country: 'MX' },
  icon_url: null,
  total_volume_usd: 0,
  total_volume_mxn: 0,
  is_featured: false,
  settled_outcome: null,
  created_by: 'admin',
  created_at: new Date().toISOString(),
  settled_at: null,
}

// Makes a chainable Supabase-style query builder that resolves to `value`
function chainable(value: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is']) {
    b[m] = vi.fn().mockReturnValue(b)
  }
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(value).then(res)
  return b
}

function makeDb(opts: {
  contracts?: Contract[]
  insertError?: boolean
} = {}) {
  const contracts = opts.contracts ?? [mockContract]
  const insertMock = vi.fn().mockResolvedValue({
    error: opts.insertError ? new Error('insert failed') : null,
  })
  const contractsChain = chainable({ data: contracts, error: null })

  return {
    from: vi.fn((table: string) => {
      if (table === 'contracts') return contractsChain
      if (table === 'oracle_readings') return { insert: insertMock }
      return {}
    }),
    _insert: insertMock,
    _in: contractsChain.in,
  }
}

describe('pollContracts', () => {
  it('defaults to querying all supported trigger types', async () => {
    const db = makeDb()
    await pollContracts(db as never, vi.fn().mockResolvedValue([]))
    expect(db._in).toHaveBeenCalledWith('trigger_type', ['weather', 'urban', 'fuel', 'air_quality', 'flood'])
  })

  it('queries only the requested trigger types when given a filter', async () => {
    const db = makeDb()
    await pollContracts(db as never, vi.fn().mockResolvedValue([]), ['urban'])
    expect(db._in).toHaveBeenCalledWith('trigger_type', ['urban'])
  })

  it('writes one oracle_readings row per contract', async () => {
    const db = makeDb()
    const mockFetcher = vi.fn().mockResolvedValue([{
      source: 'openweathermap',
      reading_type: 'weather',
      value: { rain_mm: 5, temp_c: 20 },
    }])
    const count = await pollContracts(db as never, mockFetcher)
    expect(count).toBe(1)
    expect(db._insert).toHaveBeenCalledTimes(1)
    expect(db._insert.mock.calls[0][0]).toMatchObject({
      contract_id: 'c1',
      source: 'openweathermap',
      trigger_met: false,
    })
  })

  it('sets trigger_met = true when condition is met', async () => {
    const db = makeDb()
    const mockFetcher = vi.fn().mockResolvedValue([{
      source: 'openweathermap',
      reading_type: 'weather',
      value: { rain_mm: 15, temp_c: 20 }, // 15 >= 10
    }])
    await pollContracts(db as never, mockFetcher)
    expect(db._insert.mock.calls[0][0].trigger_met).toBe(true)
  })

  it('writes multiple rows when fetcher returns multiple readings', async () => {
    const db = makeDb()
    const mockFetcher = vi.fn().mockResolvedValue([
      { source: 'openweathermap', reading_type: 'weather', value: { rain_mm: 5, temp_c: 20 } },
      { source: 'tomorrow.io',    reading_type: 'weather', value: { rain_mm: 6, temp_c: 21 } },
    ])
    const count = await pollContracts(db as never, mockFetcher)
    expect(count).toBe(1)
    expect(db._insert).toHaveBeenCalledTimes(2)
    expect(db._insert.mock.calls[1][0]).toMatchObject({ source: 'tomorrow.io' })
  })

  it('skips contracts when fetcher returns empty array', async () => {
    const db = makeDb()
    const count = await pollContracts(db as never, vi.fn().mockResolvedValue([]))
    expect(count).toBe(0)
    expect(db._insert).not.toHaveBeenCalled()
  })

  it('returns 0 and skips fetching when no active contracts', async () => {
    const db = makeDb({ contracts: [] })
    const mockFetcher = vi.fn()
    const count = await pollContracts(db as never, mockFetcher)
    expect(count).toBe(0)
    expect(mockFetcher).not.toHaveBeenCalled()
  })

  it('continues polling remaining contracts when one fetcher throws', async () => {
    const twoContracts = [mockContract, { ...mockContract, id: 'c2' }]
    const db = makeDb({ contracts: twoContracts as Contract[] })
    const mockFetcher = vi.fn()
      .mockRejectedValueOnce(new Error('API timeout'))
      .mockResolvedValueOnce([{
        source: 'openweathermap',
        reading_type: 'weather',
        value: { rain_mm: 5, temp_c: 20 },
      }])
    const count = await pollContracts(db as never, mockFetcher)
    expect(count).toBe(1)
    expect(db._insert).toHaveBeenCalledTimes(1)
  })

  it('skips urban contract when outside its corridor window', async () => {
    // 2026-05-26T20:00:00Z = 14:00 Mexico City (UTC-6) → outside 07:00–10:00 window
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T20:00:00.000Z'))

    const urbanContract: Contract = {
      ...mockContract,
      id: 'u1',
      trigger_type: 'urban',
      corridor: {
        id: 'cor1', slug: 'viaducto-am', name: 'Viaducto AM', road: 'Viaducto',
        origin_lat: 19.3983, origin_lng: -99.1918,
        dest_lat: 19.4147, dest_lng: -99.0790,
        window_start: '07:00:00', window_end: '10:00:00', baseline_duration_s: null, path_polyline: null, created_at: '',
      },
    }
    const db = makeDb({ contracts: [urbanContract] })
    const mockFetcher = vi.fn()

    const count = await pollContracts(db as never, mockFetcher)
    expect(count).toBe(0)
    expect(mockFetcher).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('polls urban contract when inside its corridor window', async () => {
    // 2026-05-26T14:00:00Z = 08:00 Mexico City (UTC-6) → inside 07:00–10:00 window
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T14:00:00.000Z'))

    const urbanContract: Contract = {
      ...mockContract,
      id: 'u2',
      trigger_type: 'urban',
      trigger_condition: { metric: 'traffic_index', threshold: 50, operator: 'gt' },
      corridor: {
        id: 'cor2', slug: 'viaducto-am', name: 'Viaducto AM', road: 'Viaducto',
        origin_lat: 19.3983, origin_lng: -99.1918,
        dest_lat: 19.4147, dest_lng: -99.0790,
        window_start: '07:00:00', window_end: '10:00:00', baseline_duration_s: 1200, path_polyline: null, created_at: '',
      },
    }
    const db = makeDb({ contracts: [urbanContract] })
    const mockFetcher = vi.fn().mockResolvedValue([{
      source: 'google_maps',
      reading_type: 'traffic',
      value: { traffic_index: 60, duration_s: 1800, static_duration_s: 1200 },
    }])

    const count = await pollContracts(db as never, mockFetcher)
    expect(count).toBe(1)
    expect(mockFetcher).toHaveBeenCalledWith(
      expect.objectContaining({ trigger_type: 'urban' }),
    )
    expect(db._insert.mock.calls[0][0]).toMatchObject({
      source: 'google_maps',
      trigger_met: true,
    })

    vi.useRealTimers()
  })

  it('never sets trigger_met on an urban contract whose corridor has no baseline', async () => {
    // Without a computed rush-hour baseline the traffic index is measured
    // against free-flow, so every ordinary rush hour would read as a trigger.
    // The reading must still be recorded (it builds the baseline history).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T14:00:00.000Z')) // inside window

    const uncalibrated: Contract = {
      ...mockContract,
      id: 'u3',
      trigger_type: 'urban',
      trigger_condition: { metric: 'traffic_index', threshold: 50, operator: 'gt' },
      corridor: {
        id: 'cor3', slug: 'roosevelt-pm', name: 'Roosevelt PM', road: 'CA-1',
        origin_lat: 14.61, origin_lng: -90.55,
        dest_lat: 14.60, dest_lng: -90.65,
        window_start: '07:00:00', window_end: '10:00:00', baseline_duration_s: null, path_polyline: null, created_at: '',
      },
    }
    const db = makeDb({ contracts: [uncalibrated] })
    const mockFetcher = vi.fn().mockResolvedValue([{
      source: 'google_maps',
      reading_type: 'traffic',
      value: { traffic_index: 100, duration_s: 3600, static_duration_s: 1800, baseline_duration_s: 1800 },
    }])

    const count = await pollContracts(db as never, mockFetcher)
    expect(count).toBe(1)
    expect(db._insert).toHaveBeenCalledTimes(1)
    expect(db._insert.mock.calls[0][0]).toMatchObject({ trigger_met: false })

    vi.useRealTimers()
  })

  it('evaluates the urban trigger normally once the corridor has a baseline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T14:00:00.000Z'))

    const calibrated: Contract = {
      ...mockContract,
      id: 'u4',
      trigger_type: 'urban',
      trigger_condition: { metric: 'traffic_index', threshold: 50, operator: 'gt' },
      corridor: {
        id: 'cor4', slug: 'roosevelt-pm', name: 'Roosevelt PM', road: 'CA-1',
        origin_lat: 14.61, origin_lng: -90.55,
        dest_lat: 14.60, dest_lng: -90.65,
        window_start: '07:00:00', window_end: '10:00:00', baseline_duration_s: 2400, path_polyline: null, created_at: '',
      },
    }
    const db = makeDb({ contracts: [calibrated] })
    const mockFetcher = vi.fn().mockResolvedValue([{
      source: 'google_maps',
      reading_type: 'traffic',
      value: { traffic_index: 60, duration_s: 3840, static_duration_s: 1800, baseline_duration_s: 2400 },
    }])

    await pollContracts(db as never, mockFetcher)
    expect(db._insert.mock.calls[0][0]).toMatchObject({ trigger_met: true })

    vi.useRealTimers()
  })

  it('polls fuel contracts using the readingFetcher', async () => {
    const fuelContract: Contract = {
      ...mockContract,
      id: 'f1',
      trigger_type: 'fuel',
      trigger_condition: {
        metric: 'price_mxn_per_liter',
        operator: 'gt',
        threshold: 25.0,
        fuel_type: 'magna',
        region: 'cdmx',
      },
    }
    const db = makeDb({ contracts: [fuelContract] })
    const mockFetcher = vi.fn().mockResolvedValue([{
      source: 'cre_datos_gob',
      reading_type: 'fuel',
      value: { price_mxn_per_liter: 26.49, fuel_type: 'magna', sample_size: 120 },
    }])
    const count = await pollContracts(db as never, mockFetcher)
    expect(count).toBe(1)
    expect(db._insert.mock.calls[0][0]).toMatchObject({
      contract_id: 'f1',
      source: 'cre_datos_gob',
      trigger_met: true, // 26.49 > 25.0
    })
  })

  it('routes a guatemala fuel contract to the AGN fetcher, not the CRE fetcher', async () => {
    const { fetchGasPrice } = await import('@/lib/oracle/gasFetcher')
    const { fetchGuatemalaFuelPrice } = await import('@/lib/oracle/guatemalaFuelFetcher')
    const gtContract: Contract = {
      ...mockContract,
      id: 'gt1',
      trigger_type: 'fuel',
      is_recurring: true,
      trigger_condition: {
        metric: 'gas_price_quetzales', operator: 'gte', threshold: 45,
        region: 'guatemala', fuel_type: 'regular',
      } as never,
    }
    const db = makeDb({ contracts: [gtContract] })
    // No readingFetcher passed → exercises the real defaultFetcher dispatch.
    await pollContracts(db as never)
    expect(fetchGuatemalaFuelPrice).toHaveBeenCalledWith('regular')
    expect(fetchGasPrice).not.toHaveBeenCalled()
    expect(db._insert).toHaveBeenCalledTimes(1)
  })
})

describe('ensureCorridorPolylines', () => {
  function makeCorridorDb(corridors: unknown[]) {
    const updateEq = vi.fn().mockResolvedValue({ error: null })
    const updateMock = vi.fn().mockReturnValue({ eq: updateEq })
    const selectChain = chainable({ data: corridors, error: null })
    return {
      from: vi.fn((t: string) =>
        t === 'corridors' ? { ...selectChain, update: updateMock } : {},
      ),
      _update: updateMock,
      _updateEq: updateEq,
    }
  }

  const geo = (id: string) => ({ id, origin_lat: 1, origin_lng: 2, dest_lat: 3, dest_lng: 4 })

  it('fills path_polyline for each corridor missing one', async () => {
    const db = makeCorridorDb([geo('cor-1'), geo('cor-2')])
    const fetcher = vi.fn().mockResolvedValue('encoded_poly')
    const count = await ensureCorridorPolylines(db as never, fetcher)
    expect(count).toBe(2)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(db._update).toHaveBeenCalledWith({ path_polyline: 'encoded_poly' })
    expect(db._updateEq).toHaveBeenCalledWith('id', 'cor-2')
  })

  it('returns 0 and fetches nothing when none are missing', async () => {
    const db = makeCorridorDb([])
    const fetcher = vi.fn()
    expect(await ensureCorridorPolylines(db as never, fetcher)).toBe(0)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('continues past a fetch failure and still fills the rest', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = makeCorridorDb([geo('cor-1'), geo('cor-2')])
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('routes 500'))
      .mockResolvedValueOnce('poly-2')
    const count = await ensureCorridorPolylines(db as never, fetcher)
    expect(count).toBe(1)
    expect(db._updateEq).toHaveBeenCalledWith('id', 'cor-2')
    errSpy.mockRestore()
  })
})

describe('POLLABLE_TRIGGER_TYPES', () => {
  it('includes air_quality and flood', () => {
    expect(POLLABLE_TRIGGER_TYPES).toContain('air_quality')
    expect(POLLABLE_TRIGGER_TYPES).toContain('flood')
  })
})
