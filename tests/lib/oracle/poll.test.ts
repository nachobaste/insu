import { describe, it, expect, vi } from 'vitest'
import { pollContracts } from '@/lib/oracle/poll'
import type { Contract } from '@/lib/types'

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

  return {
    from: vi.fn((table: string) => {
      if (table === 'contracts') return chainable({ data: contracts, error: null })
      if (table === 'oracle_readings') return { insert: insertMock }
      return {}
    }),
    _insert: insertMock,
  }
}

describe('pollContracts', () => {
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
        window_start: '07:00:00', window_end: '10:00:00', created_at: '',
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
        window_start: '07:00:00', window_end: '10:00:00', created_at: '',
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
})
