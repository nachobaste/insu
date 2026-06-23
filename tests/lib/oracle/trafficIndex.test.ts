import { describe, it, expect } from 'vitest'
import { trafficIndex, TRAFFIC_INDEX_MAX } from '@/lib/oracle/trafficIndex'

describe('trafficIndex', () => {
  it('returns percent slower than the baseline', () => {
    expect(trafficIndex(1500, 1000)).toBe(50)
  })

  it('returns 0 when equal to baseline', () => {
    expect(trafficIndex(1000, 1000)).toBe(0)
  })

  it('clamps faster-than-baseline trips to 0', () => {
    expect(trafficIndex(800, 1000)).toBe(0)
  })

  it('clamps extreme slowdowns to TRAFFIC_INDEX_MAX', () => {
    expect(trafficIndex(3000, 1000)).toBe(TRAFFIC_INDEX_MAX)
  })

  it('rounds to the nearest integer', () => {
    expect(trafficIndex(1333, 1000)).toBe(33)
  })

  it('returns 0 for a zero or missing baseline (guard)', () => {
    expect(trafficIndex(1500, 0)).toBe(0)
  })
})
