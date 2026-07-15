import { describe, it, expect } from 'vitest'
import { PERIOD_OPTIONS, availablePeriods } from '@/lib/pricing/tenors'

describe('PERIOD_OPTIONS', () => {
  it('is exactly {1, 3, 7, 30} days in order', () => {
    expect(PERIOD_OPTIONS.map((o) => o.days)).toEqual([1, 3, 7, 30])
  })
})

describe('availablePeriods', () => {
  it('calm corridor (p≈0.02) keeps the full menu', () => {
    expect(availablePeriods(0.0198).map((o) => o.days)).toEqual([1, 3, 7, 30])
  })

  it('mid corridor (p≈0.086) drops 30 but keeps 7', () => {
    expect(availablePeriods(0.0862).map((o) => o.days)).toEqual([1, 3, 7])
  })

  it('hot corridor (p≈0.20) is short-only {1, 3}', () => {
    expect(availablePeriods(0.2045).map((o) => o.days)).toEqual([1, 3])
  })

  it('always offers at least the 1-day option', () => {
    expect(availablePeriods(0.95).map((o) => o.days)).toEqual([1])
  })
})
