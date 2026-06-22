import { describe, it, expect } from 'vitest'
import {
  probAtLeastK,
  dailyHazard,
  capacityFactor,
  priceTenor,
  valuePosition,
  P_MIN,
  P_MAX,
} from '@/lib/pricing/derivative'
import type { TriggerCondition } from '@/lib/oracle/trigger'

const CONDITION: TriggerCondition = { metric: 'delay_pct', operator: 'gte', threshold: 50 }

describe('probAtLeastK', () => {
  it('P(N>=1) on 1 day = p (0.1)', () => {
    expect(probAtLeastK(1, 0.1, 1)).toBeCloseTo(0.1, 10)
  })

  it('P(N>=1) on 2 days p=0.5 = 0.75', () => {
    expect(probAtLeastK(2, 0.5, 1)).toBeCloseTo(0.75, 10)
  })

  it('P(N>=2) on 2 days p=0.5 = 0.25', () => {
    expect(probAtLeastK(2, 0.5, 2)).toBeCloseTo(0.25, 10)
  })

  it('P(N>=2) on 3 days p=0.5 = 0.5', () => {
    expect(probAtLeastK(3, 0.5, 2)).toBeCloseTo(0.5, 10)
  })

  it('k=0 always returns 1', () => {
    expect(probAtLeastK(10, 0.3, 0)).toBe(1)
  })

  it('cannot get 2 events in 1 day (returns 0)', () => {
    expect(probAtLeastK(1, 0.9, 2)).toBe(0)
  })

  it('degenerate: T=0, p=0.5, k=1 -> 0', () => {
    expect(probAtLeastK(0, 0.5, 1)).toBe(0)
  })

  it('degenerate: T=10, p=0, k=1 -> 0', () => {
    expect(probAtLeastK(10, 0, 1)).toBe(0)
  })

  it('degenerate: T=10, p=1, k=1 -> 1', () => {
    expect(probAtLeastK(10, 1, 1)).toBe(1)
  })
})

describe('dailyHazard', () => {
  it('reading delay_pct=50 with base 0.05 -> multiplier ~1.0, result ~0.05', () => {
    const reading = { value: { delay_pct: 50 } }
    const result = dailyHazard(0.05, reading, CONDITION)
    expect(result).toBeCloseTo(0.05, 5)
  })

  it('reading delay_pct=500, base 0.4 -> clamps to P_MAX', () => {
    const reading = { value: { delay_pct: 500 } }
    const result = dailyHazard(0.4, reading, CONDITION)
    expect(result).toBe(P_MAX)
  })

  it('reading delay_pct=5, base 0.001 -> clamps to P_MIN', () => {
    const reading = { value: { delay_pct: 5 } }
    const result = dailyHazard(0.001, reading, CONDITION)
    expect(result).toBe(P_MIN)
  })

  it('null reading -> base unchanged (~0.05)', () => {
    const result = dailyHazard(0.05, null, CONDITION)
    expect(result).toBeCloseTo(0.05, 5)
  })
})

describe('capacityFactor', () => {
  it('(0, 100000) -> 1.0', () => {
    expect(capacityFactor(0, 100000)).toBe(1.0)
  })

  it('(100000, 100000) -> 1.5', () => {
    expect(capacityFactor(100000, 100000)).toBe(1.5)
  })
})

describe('priceTenor', () => {
  it('Basic: 1-day payout 500 p=0.1 capFactor 1.0 -> 57.5', () => {
    const { premiumUsd } = priceTenor(500, 1, 0.1, 1, { loading: 1.15, capacityFactor: 1.0 })
    expect(premiumUsd).toBeCloseTo(57.5, 2)
  })

  it('Pro == Basic at T=1 (single day can only trigger once)', () => {
    const basic = priceTenor(500, 1, 0.1, 1, { loading: 1.15, capacityFactor: 1.0 })
    const pro = priceTenor(500, 1, 0.1, 3, { loading: 1.15, capacityFactor: 1.0 })
    expect(pro.premiumUsd).toBe(basic.premiumUsd)
  })

  it('Pro > Basic at T=30', () => {
    const basic = priceTenor(500, 30, 0.1, 1, { loading: 1.15, capacityFactor: 1.0 })
    const pro = priceTenor(500, 30, 0.1, 3, { loading: 1.15, capacityFactor: 1.0 })
    expect(pro.premiumUsd).toBeGreaterThan(basic.premiumUsd)
  })

  it('premium strictly increasing across 1 < 7 < 30 days', () => {
    const p1 = priceTenor(500, 1, 0.1, 1, { loading: 1.15, capacityFactor: 1.0 })
    const p7 = priceTenor(500, 7, 0.1, 1, { loading: 1.15, capacityFactor: 1.0 })
    const p30 = priceTenor(500, 30, 0.1, 1, { loading: 1.15, capacityFactor: 1.0 })
    expect(p7.premiumUsd).toBeGreaterThan(p1.premiumUsd)
    expect(p30.premiumUsd).toBeGreaterThan(p7.premiumUsd)
  })

  it('capacity factor 1.5 scales premium ~1.5x vs 1.0', () => {
    const low = priceTenor(500, 7, 0.1, 1, { loading: 1.15, capacityFactor: 1.0 })
    const high = priceTenor(500, 7, 0.1, 1, { loading: 1.15, capacityFactor: 1.5 })
    expect(high.premiumUsd / low.premiumUsd).toBeCloseTo(1.5, 1)
  })
})

describe('valuePosition', () => {
  it('returns 0 when remainingDays=0', () => {
    expect(valuePosition(500, 0, 0.1, 1)).toBe(0)
  })

  it('returns 0 when payoutsRemaining=0', () => {
    expect(valuePosition(500, 10, 0.1, 0)).toBe(0)
  })

  it('decays toward 0 as days shrink when OTM (days=2 < days=20 at p=0.01)', () => {
    const far = valuePosition(500, 20, 0.01, 1)
    const near = valuePosition(500, 2, 0.01, 1)
    expect(near).toBeLessThan(far)
  })

  it('approaches payout (>450) at p=0.9 days=5', () => {
    const v = valuePosition(500, 5, 0.9, 1)
    expect(v).toBeGreaterThan(450)
  })

  it('Pro (payoutsRemaining=3) > single (1) at T=30 p=0.1', () => {
    const single = valuePosition(500, 30, 0.1, 1)
    const pro = valuePosition(500, 30, 0.1, 3)
    expect(pro).toBeGreaterThan(single)
  })
})
