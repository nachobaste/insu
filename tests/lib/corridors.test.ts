import { describe, it, expect, vi, afterEach } from 'vitest'
import { getContractPeriod, getRecommendedPeriod, getUrbanRoads } from '@/lib/corridors'
import type { ContractWithTiers, Corridor } from '@/lib/types'

function makeCorridor(overrides: Partial<Corridor> = {}): Corridor {
  return {
    id: 'cor-1',
    slug: 'reforma-am',
    name: 'Reforma → Alameda (Mañana)',
    road: 'Paseo de la Reforma',
    origin_lat: 19.4001,
    origin_lng: -99.1892,
    dest_lat: 19.4354,
    dest_lng: -99.1452,
    window_start: '07:00:00',
    window_end: '10:00:00',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeContract(overrides: Partial<ContractWithTiers>): ContractWithTiers {
  return {
    id: 'id-1',
    slug: 'test-contract',
    title: 'Test',
    description: null,
    category_id: 'cat-1',
    category: { id: 'cat-1', name: 'Urban', slug: 'urban', color: '#94a3b8', icon_url: null, display_order: 1 },
    status: 'active',
    trigger_type: 'urban',
    trigger_condition: {},
    trigger_deadline: '2027-01-01T00:00:00Z',
    is_recurring: false,
    location: { lat: 0, lng: 0, city: 'Mexico City', country: 'MX' },
    icon_url: null,
    total_volume_usd: 0,
    total_volume_mxn: 0,
    is_featured: false,
    settled_outcome: null,
    created_by: 'admin',
    created_at: new Date().toISOString(),
    settled_at: null,
    coverage_tiers: [],
    corridor: null,
    ...overrides,
  }
}

describe('getContractPeriod', () => {
  it('returns "morning" for a corridor whose window starts before noon', () => {
    expect(getContractPeriod(makeCorridor({ window_start: '07:00:00' }))).toBe('morning')
  })

  it('returns "evening" for a corridor whose window starts at or after noon', () => {
    expect(getContractPeriod(makeCorridor({ window_start: '17:00:00' }))).toBe('evening')
  })
})

describe('getRecommendedPeriod', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('recommends "morning" just before 06:00', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T05:59:00'))
    expect(getRecommendedPeriod()).toBe('morning')
  })

  it('recommends "evening" at 06:00', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T06:00:00'))
    expect(getRecommendedPeriod()).toBe('evening')
  })

  it('recommends "evening" just before 20:00', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T19:59:00'))
    expect(getRecommendedPeriod()).toBe('evening')
  })

  it('recommends "morning" at 20:00', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T20:00:00'))
    expect(getRecommendedPeriod()).toBe('morning')
  })

  it('recommends "morning" late at night', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T23:00:00'))
    expect(getRecommendedPeriod()).toBe('morning')
  })
})

describe('getUrbanRoads', () => {
  it('returns distinct corridor roads in alphabetical order', () => {
    const contracts = [
      makeContract({ id: '1', corridor: makeCorridor({ road: 'Paseo de la Reforma' }) }),
      makeContract({ id: '2', corridor: makeCorridor({ road: 'Circuito Bicentenario', slug: 'bicentenario-am' }) }),
      makeContract({ id: '3', corridor: makeCorridor({ road: 'Paseo de la Reforma', slug: 'reforma-pm', window_start: '17:00:00' }) }),
    ]
    expect(getUrbanRoads(contracts)).toEqual(['Circuito Bicentenario', 'Paseo de la Reforma'])
  })

  it('ignores contracts with no corridor', () => {
    const contracts = [
      makeContract({ id: '1', corridor: null }),
      makeContract({ id: '2', corridor: makeCorridor({ road: 'Av. de las Palmas', slug: 'palmas-am' }) }),
    ]
    expect(getUrbanRoads(contracts)).toEqual(['Av. de las Palmas'])
  })

  it('returns an empty array when no contracts have corridors', () => {
    expect(getUrbanRoads([makeContract({ id: '1', corridor: null })])).toEqual([])
  })
})
