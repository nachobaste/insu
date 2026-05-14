import { describe, it, expect } from 'vitest'
import { priceTier } from '@/lib/pricing/engine'
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

  it('matches known example: 500 × 0.10 × 1.30 × 1.33 × 1.15 ≈ 99.5', () => {
    // 60% utilization → utilizationFactor = 1 + 0.5×0.6 = 1.30
    // 10 days remaining → timeFactor = 1 + 0.5×(1−10/30) = 1.333
    const tier = makeTier({ current_capacity_usd: 60000 })
    const contract = makeContract(10)
    const { premiumUsd } = priceTier(tier, contract)
    expect(premiumUsd).toBeCloseTo(99.5, 0)
  })

  it('returns structured inputs', () => {
    const { inputs } = priceTier(makeTier({ current_capacity_usd: 50000 }), makeContract(10))
    expect(inputs).toMatchObject({
      utilization: 0.5,
      utilizationFactor: 1.25,
      loadingFactor: 1.15,
    })
    expect(inputs.daysRemaining).toBeGreaterThan(9)
    expect(inputs.daysRemaining).toBeLessThan(11)
  })
})
