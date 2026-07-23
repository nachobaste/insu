import { describe, it, expect } from 'vitest'
import { PERIOD_OPTIONS, availablePeriods, FUEL_PERIOD_OPTIONS, periodMenuForContract } from '@/lib/pricing/tenors'

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

describe('FUEL_PERIOD_OPTIONS', () => {
  it('is exactly {7, 14, 30} days in order', () => {
    expect(FUEL_PERIOD_OPTIONS.map((o) => o.days)).toEqual([7, 14, 30])
  })
})

describe('periodMenuForContract', () => {
  it('returns the fuel menu for fuel contracts', () => {
    expect(periodMenuForContract({ trigger_type: 'fuel' }).map((o) => o.days)).toEqual([7, 14, 30])
  })
  it('returns the global menu for non-fuel contracts', () => {
    expect(periodMenuForContract({ trigger_type: 'urban' }).map((o) => o.days)).toEqual([1, 3, 7, 30])
  })
})

describe('availablePeriods with a custom menu', () => {
  it('filters the fuel menu by cap at low hazard (all offered)', () => {
    expect(availablePeriods(0.0043, FUEL_PERIOD_OPTIONS).map((o) => o.days)).toEqual([7, 14, 30])
  })
  it('falls back to the first menu option when none fit', () => {
    expect(availablePeriods(0.95, FUEL_PERIOD_OPTIONS).map((o) => o.days)).toEqual([7])
  })
})
