import { describe, it, expect } from 'vitest'
import { computeOracleMultiplier } from '@/lib/oracle/multiplier'
import type { TriggerCondition } from '@/lib/oracle/trigger'

function reading(value: Record<string, unknown>) {
  return { value }
}

function cond(metric: string, threshold: number, operator: TriggerCondition['operator']): TriggerCondition {
  return { metric, threshold, operator }
}

describe('computeOracleMultiplier', () => {
  it('gte: returns 1.0 exactly at threshold', () => {
    expect(computeOracleMultiplier(reading({ temp_c: 35 }), cond('temp_c', 35, 'gte'))).toBeCloseTo(1.0, 5)
  })

  it('gte: returns < 1 when below threshold', () => {
    const result = computeOracleMultiplier(reading({ temp_c: 17.5 }), cond('temp_c', 35, 'gte'))
    expect(result).toBeCloseTo(0.5, 5)
  })

  it('gte: returns > 1 when above threshold', () => {
    const result = computeOracleMultiplier(reading({ temp_c: 70 }), cond('temp_c', 35, 'gte'))
    expect(result).toBeCloseTo(2.0, 5)
  })

  it('gt: same proximity direction as gte', () => {
    expect(computeOracleMultiplier(reading({ temp_c: 35 }), cond('temp_c', 35, 'gt'))).toBeCloseTo(1.0, 5)
  })

  it('lte: returns 1.0 exactly at threshold', () => {
    // trigger fires when actual <= threshold; actual = threshold → proximity = threshold/actual = 1
    expect(computeOracleMultiplier(reading({ jam: 5 }), cond('jam', 5, 'lte'))).toBeCloseTo(1.0, 5)
  })

  it('lte: returns > 1 when actual < threshold (conditions worsening toward trigger)', () => {
    // threshold=10, actual=5 → proximity = 10/5 = 2.0 → multiplier = 2.0
    const result = computeOracleMultiplier(reading({ jam: 5 }), cond('jam', 10, 'lte'))
    expect(result).toBeCloseTo(2.0, 5)
  })

  it('lt: same proximity direction as lte', () => {
    expect(computeOracleMultiplier(reading({ jam: 5 }), cond('jam', 5, 'lt'))).toBeCloseTo(1.0, 5)
  })

  it('lte: returns < 1 when actual > threshold (conditions favorable)', () => {
    // threshold=5, actual=10 → proximity = 5/10 = 0.5
    const result = computeOracleMultiplier(reading({ jam: 10 }), cond('jam', 5, 'lte'))
    expect(result).toBeCloseTo(0.5, 5)
  })

  it('clamps at MIN=0.3 for very favorable conditions', () => {
    // gte: actual=1, threshold=100 → proximity=0.01 → clamped to 0.3
    expect(computeOracleMultiplier(reading({ temp_c: 1 }), cond('temp_c', 100, 'gte'))).toBe(0.3)
  })

  it('clamps at MAX=3.0 for extreme conditions', () => {
    // gte: actual=1000, threshold=10 → proximity=100 → clamped to 3.0
    expect(computeOracleMultiplier(reading({ temp_c: 1000 }), cond('temp_c', 10, 'gte'))).toBe(3.0)
  })

  it('returns 1.0 when metric is missing from reading', () => {
    expect(computeOracleMultiplier(reading({ other: 99 }), cond('temp_c', 35, 'gte'))).toBe(1.0)
  })

  it('returns 1.0 when metric value is not a number', () => {
    expect(computeOracleMultiplier(reading({ temp_c: 'hot' }), cond('temp_c', 35, 'gte'))).toBe(1.0)
  })

  it('returns 1.0 when threshold is zero (guard against division by zero)', () => {
    expect(computeOracleMultiplier(reading({ temp_c: 35 }), cond('temp_c', 0, 'gte'))).toBe(1.0)
  })
})
