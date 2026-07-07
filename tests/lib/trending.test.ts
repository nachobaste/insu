import { describe, it, expect, afterEach, vi } from 'vitest'
import { scoreTrending } from '@/lib/trending'
import type { ContractWithTiers, Corridor } from '@/lib/types'

function makeContract(overrides: Partial<ContractWithTiers>): ContractWithTiers {
  return {
    id: 'id-1',
    slug: 'test-contract',
    title: 'Test',
    description: null,
    category_id: 'cat-1',
    category: { id: 'cat-1', name: 'Urban', slug: 'urban', color: '#94a3b8', icon_url: null, display_order: 1 },
    status: 'active',
    trigger_type: 'manual',
    trigger_condition: {},
    trigger_deadline: '2027-01-01T00:00:00Z',
    is_recurring: false,
    location: { lat: 0, lng: 0, city: 'Test', country: 'MX' },
    icon_url: null,
    total_volume_usd: 1_000_000,
    total_volume_mxn: 0,
    is_featured: false,
    settled_outcome: null,
    created_by: 'admin',
    created_at: new Date().toISOString(),
    settled_at: null,
    coverage_tiers: [],
    ...overrides,
  }
}

describe('scoreTrending', () => {
  it('returns top 4 contracts by score', () => {
    const contracts = [
      makeContract({ id: '1', total_volume_usd: 1_000_000 }),
      makeContract({ id: '2', total_volume_usd: 9_000_000 }),
      makeContract({ id: '3', total_volume_usd: 5_000_000 }),
      makeContract({ id: '4', total_volume_usd: 3_000_000 }),
      makeContract({ id: '5', total_volume_usd: 500_000 }),
    ]
    const result = scoreTrending(contracts)
    expect(result).toHaveLength(4)
    expect(result[0].id).toBe('2')
    expect(result[1].id).toBe('3')
  })

  it('applies 0.5 recency weight to contracts older than 60 days', () => {
    const old = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString()
    const recent = new Date().toISOString()
    const contracts = [
      makeContract({ id: 'old',    total_volume_usd: 10_000_000, created_at: old }),
      makeContract({ id: 'recent', total_volume_usd: 6_000_000,  created_at: recent }),
    ]
    // old score = 10_000_000 * 0.5 = 5_000_000
    // recent score = 6_000_000 * 1.0 = 6_000_000  → recent wins
    const result = scoreTrending(contracts)
    expect(result[0].id).toBe('recent')
  })

  it('returns fewer than 4 if the input has fewer than 4 contracts', () => {
    const contracts = [
      makeContract({ id: '1' }),
      makeContract({ id: '2' }),
    ]
    expect(scoreTrending(contracts)).toHaveLength(2)
  })

  it('returns empty array for empty input', () => {
    expect(scoreTrending([])).toHaveLength(0)
  })

  it('does not mutate the original array', () => {
    const contracts = [
      makeContract({ id: '1', total_volume_usd: 5_000_000 }),
      makeContract({ id: '2', total_volume_usd: 9_000_000 }),
    ]
    const original = [...contracts]
    scoreTrending(contracts)
    expect(contracts[0].id).toBe(original[0].id)
  })

  describe('corridor pair dedupe', () => {
    function makeCorridor(overrides: Partial<Corridor>): Corridor {
      return {
        id: 'cor-1',
        slug: 'test-am',
        name: 'Test (Mañana)',
        road: 'Carretera a El Salvador (CA-1 Oriente)',
        origin_lat: 0,
        origin_lng: 0,
        dest_lat: 0,
        dest_lng: 0,
        window_start: '07:00',
        window_end: '10:00',
        ...overrides,
      } as Corridor
    }

    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows one card per road, preferring the recommended commute period', () => {
      // 2pm local → recommended period is the evening commute
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 6, 6, 14, 0, 0))

      const am = makeContract({
        id: 'gt-am',
        corridor: makeCorridor({ id: 'cor-am', window_start: '07:00', window_end: '10:00' }),
      })
      const pm = makeContract({
        id: 'gt-pm',
        corridor: makeCorridor({ id: 'cor-pm', window_start: '17:00', window_end: '20:00' }),
      })

      const result = scoreTrending([am, pm])
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('gt-pm')
    })

    it('keeps the recommended period regardless of input order', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 6, 6, 14, 0, 0))

      const am = makeContract({
        id: 'gt-am',
        corridor: makeCorridor({ id: 'cor-am', window_start: '07:00', window_end: '10:00' }),
      })
      const pm = makeContract({
        id: 'gt-pm',
        corridor: makeCorridor({ id: 'cor-pm', window_start: '17:00', window_end: '20:00' }),
      })

      const result = scoreTrending([pm, am])
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('gt-pm')
    })

    it('keeps the lone direction when a road has only one contract', () => {
      const am = makeContract({
        id: 'solo-am',
        corridor: makeCorridor({ id: 'cor-am' }),
      })
      const result = scoreTrending([am])
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('solo-am')
    })

    it('does not dedupe across different roads or non-corridor contracts', () => {
      const roadA = makeContract({
        id: 'a',
        corridor: makeCorridor({ id: 'cor-a', road: 'Road A' }),
      })
      const roadB = makeContract({
        id: 'b',
        corridor: makeCorridor({ id: 'cor-b', road: 'Road B' }),
      })
      const plain = makeContract({ id: 'plain', corridor: null })
      expect(scoreTrending([roadA, roadB, plain])).toHaveLength(3)
    })
  })
})
