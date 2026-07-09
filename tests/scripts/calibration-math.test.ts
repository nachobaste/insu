import { describe, it, expect } from 'vitest'
import {
  median,
  credibilityWeight,
  blendBaseline,
  normCdf,
  sigmaFromEnvelope,
  breachProbability,
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

describe('normCdf', () => {
  it('is 0.5 at 0', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6)
  })
  it('matches the 95th percentile', () => {
    expect(normCdf(1.645)).toBeCloseTo(0.95, 3)
  })
  it('is symmetric', () => {
    expect(normCdf(-1.645)).toBeCloseTo(0.05, 3)
  })
})

describe('sigmaFromEnvelope', () => {
  it('computes sigma = ln(pess/opt) / (2z)', () => {
    // ln(5959/1901) = ln(3.1347) = 1.1426; / (2*1.2816) = 0.4458
    expect(sigmaFromEnvelope(1901, 5959, 1.2816)).toBeCloseTo(0.4458, 3)
  })
  it('returns null for degenerate input', () => {
    expect(sigmaFromEnvelope(0, 5959, 1.2816)).toBeNull()
    expect(sigmaFromEnvelope(2000, 2000, 1.2816)).toBeNull() // zero spread
  })
})

describe('breachProbability', () => {
  it('computes P(X > baseline * (1 + threshold/100)) under lognormal(mu, sigma)', () => {
    // mu = ln(3000), sigma = 0.4, baseline = 3000, threshold = 50
    // x = ln(1.5)/0.4 = 1.0137 -> p = 1 - Phi(1.0137) ≈ 0.1554
    const p = breachProbability({ baselineS: 3000, thresholdPct: 50, muLog: Math.log(3000), sigma: 0.4 })
    expect(p).toBeCloseTo(0.1554, 2)
  })
  it('is higher when the typical duration already sits above the baseline', () => {
    const pAtBaseline = breachProbability({ baselineS: 3000, thresholdPct: 50, muLog: Math.log(3000), sigma: 0.4 })
    const pAboveBaseline = breachProbability({ baselineS: 2500, thresholdPct: 50, muLog: Math.log(3000), sigma: 0.4 })
    expect(pAboveBaseline).toBeGreaterThan(pAtBaseline)
  })
  it('returns null when sigma is invalid', () => {
    expect(breachProbability({ baselineS: 3000, thresholdPct: 50, muLog: Math.log(3000), sigma: null })).toBeNull()
  })
})
