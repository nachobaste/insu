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
    const mockFetcher = vi.fn().mockResolvedValue({
      source: 'openweathermap',
      reading_type: 'weather',
      value: { rain_mm: 5, temp_c: 20 },
    })
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
    const mockFetcher = vi.fn().mockResolvedValue({
      source: 'openweathermap',
      reading_type: 'weather',
      value: { rain_mm: 15, temp_c: 20 }, // 15 >= 10
    })
    await pollContracts(db as never, mockFetcher)
    expect(db._insert.mock.calls[0][0].trigger_met).toBe(true)
  })

  it('skips contracts when fetcher returns null', async () => {
    const db = makeDb()
    const count = await pollContracts(db as never, vi.fn().mockResolvedValue(null))
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
      .mockResolvedValueOnce({
        source: 'openweathermap',
        reading_type: 'weather',
        value: { rain_mm: 5, temp_c: 20 },
      })
    const count = await pollContracts(db as never, mockFetcher)
    expect(count).toBe(1)
    expect(db._insert).toHaveBeenCalledTimes(1)
  })
})
