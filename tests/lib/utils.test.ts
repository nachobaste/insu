// tests/lib/utils.test.ts
import { describe, it, expect } from 'vitest'
import { formatCurrency, formatVolume, categoryColorClass } from '@/lib/utils'

describe('formatCurrency', () => {
  it('formats USD amounts with an explicit currency code', () => {
    expect(formatCurrency(500, 'USD')).toBe('$500 USD')
    expect(formatCurrency(1700, 'USD')).toBe('$1,700 USD')
  })

  it('formats MXN amounts with an explicit currency code', () => {
    expect(formatCurrency(9500, 'MXN')).toContain('9,500')
    expect(formatCurrency(9500, 'MXN')).toContain('MXN')
  })
})

describe('formatVolume', () => {
  it('formats millions', () => {
    expect(formatVolume(9_000_000)).toBe('$9.0m')
    expect(formatVolume(2_400_000)).toBe('$2.4m')
  })

  it('formats thousands', () => {
    expect(formatVolume(314_000)).toBe('$314k')
  })

  it('formats small amounts', () => {
    expect(formatVolume(500)).toBe('$500')
  })
})

describe('categoryColorClass', () => {
  it('returns correct class for each category', () => {
    expect(categoryColorClass('urban')).toContain('text-category-urban')
    expect(categoryColorClass('nature')).toContain('text-category-nature')
    expect(categoryColorClass('experiences')).toContain('text-category-experiences')
    expect(categoryColorClass('events')).toContain('text-category-events')
  })

  it('returns empty string for unknown category', () => {
    expect(categoryColorClass('unknown')).toBe('')
  })
})
