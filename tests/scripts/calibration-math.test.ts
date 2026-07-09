import { describe, it, expect } from 'vitest'
import {
  median,
  credibilityWeight,
  blendBaseline,
} from '../../scripts/lib/calibration-math.mjs'

describe('median', () => {
  it('returns null for empty input', () => {
    expect(median([])).toBeNull()
  })
  it('returns the middle element for odd length', () => {
    expect(median([3, 1, 2])).toBe(2)
  })
  it('returns the rounded mean of the two middle elements for even length', () => {
    expect(median([1, 2, 3, 10])).toBe(3) // (2+3)/2 = 2.5 -> rounds to 3
  })
})

describe('credibilityWeight', () => {
  it('is 0 with no observations', () => {
    expect(credibilityWeight(0, 10)).toBe(0)
  })
  it('is 0.5 when n equals K', () => {
    expect(credibilityWeight(10, 10)).toBe(0.5)
  })
  it('approaches 1 as n grows', () => {
    expect(credibilityWeight(90, 10)).toBe(0.9)
  })
})

describe('blendBaseline', () => {
  it('returns pure prediction when there is no harvested data', () => {
    expect(
      blendBaseline({ harvestedMedianS: null, harvestedWeekdayDays: 0, predictedMedianS: 2856, k: 10 }),
    ).toEqual({ baselineS: 2856, source: 'predicted' })
  })
  it('returns pure harvested when there is no prediction', () => {
    expect(
      blendBaseline({ harvestedMedianS: 3110, harvestedWeekdayDays: 12, predictedMedianS: null, k: 10 }),
    ).toEqual({ baselineS: 3110, source: 'harvested' })
  })
  it('blends 50/50 at n = K', () => {
    expect(
      blendBaseline({ harvestedMedianS: 3110, harvestedWeekdayDays: 10, predictedMedianS: 2856, k: 10 }),
    ).toEqual({ baselineS: 2983, source: 'blended' }) // 0.5*3110 + 0.5*2856 = 2983
  })
  it('returns null baseline when neither input exists', () => {
    expect(
      blendBaseline({ harvestedMedianS: null, harvestedWeekdayDays: 0, predictedMedianS: null, k: 10 }),
    ).toEqual({ baselineS: null, source: null })
  })
})
