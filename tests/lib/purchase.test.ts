import { describe, it, expect } from 'vitest'
import { validateCapacity } from '@/lib/actions/purchase'

describe('validateCapacity', () => {
  it('returns null when capacity is available', () => {
    expect(validateCapacity(100000, 50000, 500)).toBeNull()
  })

  it('returns error when tier is full', () => {
    expect(validateCapacity(100000, 100000, 100)).toMatch(/at capacity/)
  })

  it('returns error when requested amount exceeds remaining', () => {
    expect(validateCapacity(100000, 95000, 10000)).toMatch(/Maximum available/)
  })

  it('returns null when amount equals exactly remaining capacity', () => {
    expect(validateCapacity(100000, 95000, 5000)).toBeNull()
  })
})
