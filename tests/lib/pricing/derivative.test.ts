import { describe, it, expect } from 'vitest'
import {
  probAtLeastK,
  dailyHazard,
  capacityFactor,
  priceTenor,
  valuePosition,
  tenorAvailable,
  P_MIN,
  P_MAX,
  MAX_PREMIUM_FRACTION,
  MIN_PREMIUM_USD,
  LOADING_FACTOR,
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

  it('off-window reading (delay_pct=5) never discounts below base — floor is 1.0, not 0.3', () => {
    // base_probability is already the calibrated daily window probability; an
    // off-window snapshot must not discount it (the old 0.3 floor pinned every
    // recurring premium to 0.3x fair value).
    const reading = { value: { delay_pct: 5 } }
    const result = dailyHazard(0.05, reading, CONDITION)
    expect(result).toBeCloseTo(0.05, 5)
  })

  it('off-window reading with tiny base (0.001) returns base, not base x 0.3', () => {
    const reading = { value: { delay_pct: 5 } }
    const result = dailyHazard(0.001, reading, CONDITION)
    expect(result).toBeCloseTo(0.001, 6)
  })

  it('near-trigger upside still applies: delay_pct=100 doubles base', () => {
    const reading = { value: { delay_pct: 100 } }
    const result = dailyHazard(0.05, reading, CONDITION)
    expect(result).toBeCloseTo(0.10, 5)
  })

  it('base below P_MIN clamps to P_MIN', () => {
    const reading = { value: { delay_pct: 50 } }
    const result = dailyHazard(0.0001, reading, CONDITION)
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

  it('capacity factor 1.5 scales premium ~1.5x vs 1.0 (below the premium cap)', () => {
    // p=0.02 keeps both quotes well under MAX_PREMIUM_FRACTION so the linear
    // capacity scaling is observable (at p=0.1 the 1.5x quote would be capped).
    const low = priceTenor(500, 7, 0.02, 1, { loading: 1.15, capacityFactor: 1.0 })
    const high = priceTenor(500, 7, 0.02, 1, { loading: 1.15, capacityFactor: 1.5 })
    expect(high.premiumUsd / low.premiumUsd).toBeCloseTo(1.5, 1)
  })

  it('premium is capped at MAX_PREMIUM_FRACTION of max payout (Basic, long tenor)', () => {
    // 30 days at p=0.1 -> raw premium would exceed the $500 payout; cap pins it.
    const { premiumUsd } = priceTenor(500, 30, 0.1, 1, { loading: 1.15, capacityFactor: 1.0 })
    expect(premiumUsd).toBe(500 * 1 * MAX_PREMIUM_FRACTION) // 350
    expect(premiumUsd).toBeLessThan(500)
  })

  it('premium cap scales with maxPayouts (Pro caps higher than Basic)', () => {
    const basic = priceTenor(500, 30, 0.2, 1, { loading: 1.15, capacityFactor: 1.5 })
    const pro = priceTenor(500, 30, 0.2, 3, { loading: 1.15, capacityFactor: 1.5 })
    expect(basic.premiumUsd).toBe(500 * 1 * MAX_PREMIUM_FRACTION) // 350
    expect(pro.premiumUsd).toBe(500 * 3 * MAX_PREMIUM_FRACTION)   // 1050
  })
})

describe('priceTenor minimum premium floor', () => {
  it('floors a tiny fair premium at MIN_PREMIUM_USD', () => {
    // palmas-bosques Basic 1-day: payout 100, p 0.0198 -> fair ≈ $2.28, below floor
    const { premiumUsd } = priceTenor(100, 1, 0.0198, 1)
    expect(premiumUsd).toBe(MIN_PREMIUM_USD)
  })

  it('does not raise a premium already above the floor', () => {
    // p 0.10 -> fair 100*0.10*1.15 = $11.50
    const { premiumUsd } = priceTenor(100, 1, 0.10, 1)
    expect(premiumUsd).toBeCloseTo(11.5, 2)
  })

  it('the cap still wins over the floor for high hazard', () => {
    // p 0.20 over 30 days -> raw far above cap; cap = 100*1*0.70 = $70
    const { premiumUsd } = priceTenor(100, 30, 0.20, 1)
    expect(premiumUsd).toBe(70)
  })

  it('MIN_PREMIUM_USD is 5', () => {
    expect(MIN_PREMIUM_USD).toBe(5)
  })
})

describe('tenorAvailable', () => {
  it('1-day is available for every realistic hazard', () => {
    expect(tenorAvailable(1, 0.2045)).toBe(true) // hottest live corridor
    expect(tenorAvailable(1, 0.0198)).toBe(true)
  })

  it('hot corridor (p≈0.20) allows 3 days but not 7', () => {
    expect(tenorAvailable(3, 0.2045)).toBe(true)
    expect(tenorAvailable(7, 0.2045)).toBe(false)
  })

  it('calm corridor (p≈0.02) allows 30 days', () => {
    expect(tenorAvailable(30, 0.0198)).toBe(true)
  })

  it('gates exactly on LOADING_FACTOR * P(>=1) <= MAX_PREMIUM_FRACTION', () => {
    // Construct p so P(>=1) over 1 day = 0.70/1.15 exactly at the boundary
    const boundaryP = MAX_PREMIUM_FRACTION / LOADING_FACTOR // ≈ 0.6087
    expect(tenorAvailable(1, boundaryP)).toBe(true)          // == boundary, allowed
    expect(tenorAvailable(1, boundaryP + 0.001)).toBe(false) // just over, blocked
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
