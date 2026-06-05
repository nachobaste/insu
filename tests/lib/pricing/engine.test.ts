import { describe, it, expect } from 'vitest'
import { priceTier, computePeriodFactor } from '@/lib/pricing/engine'
import type { CoverageTier, Contract } from '@/lib/types'

function makeTier(overrides: Partial<CoverageTier> = {}): CoverageTier {
  return {
    id: 'tier-1',
    contract_id: 'c1',
    name: 'basic',
    premium_usd: 50,
    payout_usd: 500,
    premium_mxn: 850,
    payout_mxn: 8500,
    max_capacity_usd: 100000,
    current_capacity_usd: 0,
    base_probability: 0.10,
    last_priced_at: null,
    pricing_inputs: null,
    ...overrides,
  }
}

function makeContract(daysFromNow: number, overrides: Partial<Contract> = {}): Contract {
  const deadline = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString()
  return {
    id: 'c1',
    slug: 'test-contract',
    title: 'Test',
    description: null,
    category_id: 'cat-1',
    status: 'active',
    trigger_type: 'manual',
    trigger_condition: {},
    trigger_deadline: deadline,
    is_recurring: false,
    location: { lat: 0, lng: 0, city: 'Test', country: 'MX' },
    icon_url: null,
    total_volume_usd: 0,
    total_volume_mxn: 0,
    is_featured: false,
    settled_outcome: null,
    created_by: 'admin',
    created_at: new Date().toISOString(),
    settled_at: null,
    ...overrides,
  }
}

describe('priceTier', () => {
  it('loading factor always applied — output exceeds payout × probability', () => {
    const { premiumUsd } = priceTier(makeTier(), makeContract(60))
    expect(premiumUsd).toBeGreaterThan(500 * 0.10)
  })

  it('premium increases as utilization rises', () => {
    const contract = makeContract(60)
    const low  = priceTier(makeTier({ current_capacity_usd: 0 }),      contract).premiumUsd
    const mid  = priceTier(makeTier({ current_capacity_usd: 50000 }),   contract).premiumUsd
    const high = priceTier(makeTier({ current_capacity_usd: 100000 }),  contract).premiumUsd
    expect(low).toBeLessThan(mid)
    expect(mid).toBeLessThan(high)
  })

  it('premium is flat beyond 30 days', () => {
    const tier = makeTier()
    const at60 = priceTier(tier, makeContract(60)).premiumUsd
    const at45 = priceTier(tier, makeContract(45)).premiumUsd
    expect(at60).toBeCloseTo(at45, 2)
  })

  it('premium increases as deadline approaches within 30 days', () => {
    const tier = makeTier()
    const at30 = priceTier(tier, makeContract(30)).premiumUsd
    const at15 = priceTier(tier, makeContract(15)).premiumUsd
    const at2  = priceTier(tier, makeContract(2)).premiumUsd
    expect(at30).toBeLessThan(at15)
    expect(at15).toBeLessThan(at2)
  })

  it('matches known example: 500 × 0.10 × 1.30 × 1.33 × 1.15 ≈ 99.67', () => {
    // 60% utilization → utilizationFactor = 1 + 0.5×0.6 = 1.30
    // 10 days remaining → timeFactor = 1 + 0.5×(1−10/30) = 1.3333
    const tier = makeTier({ current_capacity_usd: 60000 })
    const contract = makeContract(10)
    const { premiumUsd } = priceTier(tier, contract)
    expect(premiumUsd).toBeCloseTo(99.67, 1)
  })

  it('returns structured inputs', () => {
    const { inputs } = priceTier(makeTier({ current_capacity_usd: 50000 }), makeContract(10))
    expect(inputs).toMatchObject({
      utilization: 0.5,
      utilizationFactor: 1.25,
      loadingFactor: 1.15,
      oracleMultiplier: 1,
    })
    expect(inputs.daysRemaining).toBeGreaterThan(9)
    expect(inputs.daysRemaining).toBeLessThan(11)
  })

  it('handles zero-capacity guard without division by zero', () => {
    const tier = makeTier({ max_capacity_usd: 0, current_capacity_usd: 0 })
    const contract = makeContract(10)
    const { premiumUsd, inputs } = priceTier(tier, contract)
    expect(inputs.utilization).toBe(0)
    expect(premiumUsd).toBeGreaterThan(0)
  })

  it('oracle multiplier scales premium proportionally', () => {
    const tier = makeTier()
    const contract = makeContract(60)
    const base = priceTier(tier, contract, 1.0).premiumUsd
    const doubled = priceTier(tier, contract, 2.0).premiumUsd
    expect(doubled).toBeCloseTo(base * 2, 1)
  })

  it('oracle multiplier is stored in returned inputs', () => {
    const { inputs } = priceTier(makeTier(), makeContract(60), 1.5)
    expect(inputs.oracleMultiplier).toBe(1.5)
  })
})

describe('computePeriodFactor', () => {
  // Contract: created 2026-01-01, deadline 2026-07-01 → 181 days
  const contract = {
    created_at: '2026-01-01T00:00:00Z',
    trigger_deadline: '2026-07-01T00:00:00Z',
  }

  it('returns correct factor for 7-day period on 181-day contract', () => {
    const factor = computePeriodFactor(7, contract)
    expect(factor).toBeCloseTo(7 / 181, 4)
  })

  it('returns correct factor for 30-day period', () => {
    const factor = computePeriodFactor(30, contract)
    expect(factor).toBeCloseTo(30 / 181, 4)
  })

  it('clamps to 1.0 when period >= contract duration', () => {
    expect(computePeriodFactor(200, contract)).toBe(1.0)
    expect(computePeriodFactor(181, contract)).toBe(1.0)
  })

  it('returns 1.0 when contract duration is zero or negative', () => {
    const sameDay = { created_at: '2026-01-01T00:00:00Z', trigger_deadline: '2026-01-01T00:00:00Z' }
    expect(computePeriodFactor(7, sameDay)).toBe(1.0)

    const backwards = { created_at: '2026-07-01T00:00:00Z', trigger_deadline: '2026-01-01T00:00:00Z' }
    expect(computePeriodFactor(7, backwards)).toBe(1.0)
  })

  it('returns 1.0 for 1-day period on 1-day contract', () => {
    const oneDay = { created_at: '2026-01-01T00:00:00Z', trigger_deadline: '2026-01-02T00:00:00Z' }
    expect(computePeriodFactor(1, oneDay)).toBe(1.0)
  })
})
