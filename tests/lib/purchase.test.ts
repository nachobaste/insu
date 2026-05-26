import { describe, it, expect } from 'vitest'
import { validateProviderCapacity, validateBuyerCapacity } from '@/lib/utils/capacity'

describe('validateProviderCapacity', () => {
  it('returns null when pool has room', () => {
    expect(validateProviderCapacity(100000, 50000, 500)).toBeNull()
  })

  it('returns error when pool is full', () => {
    expect(validateProviderCapacity(100000, 100000, 100)).toMatch(/at capacity/)
  })

  it('returns error when deposit exceeds remaining room', () => {
    expect(validateProviderCapacity(100000, 95000, 10000)).toMatch(/Maximum available/)
  })

  it('returns null when deposit equals exactly remaining room', () => {
    expect(validateProviderCapacity(100000, 95000, 5000)).toBeNull()
  })
})

describe('validateBuyerCapacity', () => {
  it('returns null when pool covers payout', () => {
    expect(validateBuyerCapacity(10000, 500)).toBeNull()
  })

  it('returns null when pool exactly equals payout', () => {
    expect(validateBuyerCapacity(500, 500)).toBeNull()
  })

  it('returns error when pool is empty', () => {
    expect(validateBuyerCapacity(0, 500)).toMatch(/No capital/)
  })

  it('returns error when pool is smaller than payout', () => {
    expect(validateBuyerCapacity(200, 500)).toMatch(/too low/)
  })
})
