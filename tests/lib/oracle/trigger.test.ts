import { describe, it, expect } from 'vitest'
import { evaluateTrigger } from '@/lib/oracle/trigger'

describe('evaluateTrigger', () => {
  it('returns true when metric gte threshold', () => {
    expect(evaluateTrigger(
      { metric: 'rain_mm', threshold: 10, operator: 'gte' },
      { rain_mm: 15 },
    )).toBe(true)
  })

  it('returns false when metric below gte threshold', () => {
    expect(evaluateTrigger(
      { metric: 'rain_mm', threshold: 10, operator: 'gte' },
      { rain_mm: 5 },
    )).toBe(false)
  })

  it('returns true when metric equals threshold (gte)', () => {
    expect(evaluateTrigger(
      { metric: 'rain_mm', threshold: 10, operator: 'gte' },
      { rain_mm: 10 },
    )).toBe(true)
  })

  it('returns true for lte when metric at or below threshold', () => {
    expect(evaluateTrigger(
      { metric: 'temp_c', threshold: 0, operator: 'lte' },
      { temp_c: -5 },
    )).toBe(true)
  })

  it('returns false for lte when metric above threshold', () => {
    expect(evaluateTrigger(
      { metric: 'temp_c', threshold: 0, operator: 'lte' },
      { temp_c: 5 },
    )).toBe(false)
  })

  it('returns true for gt when strictly above threshold', () => {
    expect(evaluateTrigger(
      { metric: 'traffic_index', threshold: 8, operator: 'gt' },
      { traffic_index: 9 },
    )).toBe(true)
  })

  it('returns false for gt when equal to threshold', () => {
    expect(evaluateTrigger(
      { metric: 'traffic_index', threshold: 8, operator: 'gt' },
      { traffic_index: 8 },
    )).toBe(false)
  })

  it('returns false when metric key is missing from value', () => {
    expect(evaluateTrigger(
      { metric: 'rain_mm', threshold: 10, operator: 'gte' },
      { temp_c: 25 },
    )).toBe(false)
  })

  it('returns false when metric value is not a number', () => {
    expect(evaluateTrigger(
      { metric: 'rain_mm', threshold: 10, operator: 'gte' },
      { rain_mm: 'heavy' },
    )).toBe(false)
  })
})
