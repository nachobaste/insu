// tests/lib/currency/resolve.test.ts
import { describe, it, expect } from 'vitest'
import {
  localCurrencyForCountry,
  resolveDisplayCurrency,
  convertFromUsd,
  displayPrice,
} from '@/lib/currency/resolve'

describe('localCurrencyForCountry', () => {
  it('maps configured countries', () => {
    expect(localCurrencyForCountry('GT')).toBe('GTQ')
    expect(localCurrencyForCountry('MX')).toBe('MXN')
  })
  it('normalizes the legacy "Mexico" value', () => {
    expect(localCurrencyForCountry('Mexico')).toBe('MXN')
  })
  it('returns null for missing or unconfigured countries', () => {
    expect(localCurrencyForCountry(null)).toBeNull()
    expect(localCurrencyForCountry(undefined)).toBeNull()
    expect(localCurrencyForCountry('BR')).toBeNull()
  })
})

describe('resolveDisplayCurrency', () => {
  it('USD mode always returns USD', () => {
    expect(resolveDisplayCurrency('USD', 'GT')).toBe('USD')
  })
  it('LOCAL mode returns the country currency', () => {
    expect(resolveDisplayCurrency('LOCAL', 'GT')).toBe('GTQ')
    expect(resolveDisplayCurrency('LOCAL', 'MX')).toBe('MXN')
  })
  it('LOCAL mode falls back to USD for unconfigured countries', () => {
    expect(resolveDisplayCurrency('LOCAL', 'BR')).toBe('USD')
    expect(resolveDisplayCurrency('LOCAL', null)).toBe('USD')
  })
})

describe('convertFromUsd', () => {
  it('returns the same amount for USD', () => {
    expect(convertFromUsd(100, 'USD')).toBe(100)
  })
  it('converts and rounds to whole units', () => {
    expect(convertFromUsd(100, 'MXN')).toBe(1700)
    expect(convertFromUsd(28.76, 'GTQ')).toBe(223) // 28.76 * 7.75 = 222.89 -> 223
  })
})

describe('displayPrice', () => {
  it('formats a GT contract price in quetzales under LOCAL mode', () => {
    const r = displayPrice(28.76, 'LOCAL', 'GT')
    expect(r.currency).toBe('GTQ')
    expect(r.amount).toBe(223)
    expect(r.formatted).toContain('Q223')
  })
  it('formats in USD under USD mode', () => {
    const r = displayPrice(28.76, 'USD', 'GT')
    expect(r.currency).toBe('USD')
    expect(r.amount).toBe(28.76)
    expect(r.formatted).toBe('$29 USD')
  })
})
