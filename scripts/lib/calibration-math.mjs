// Pure calibration math shared by scripts/calibrate-corridors.mjs.
// Formulas documented in docs/superpowers/plans/2026-07-09-credibility-weighted-calibration.md.

/** Median of a numeric array, rounded to an integer. Null for empty input. */
export function median(nums) {
  if (!nums || nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/** Classical credibility weight w = n / (n + k). */
export function credibilityWeight(n, k) {
  if (!Number.isFinite(n) || n <= 0) return 0
  return n / (n + k)
}

/**
 * Blend a harvested median with a model-predicted median.
 * Returns { baselineS, source } where source ∈ 'harvested'|'predicted'|'blended'|null.
 */
export function blendBaseline({ harvestedMedianS, harvestedWeekdayDays, predictedMedianS, k }) {
  const hasHarvested = Number.isFinite(harvestedMedianS) && harvestedMedianS > 0
  const hasPredicted = Number.isFinite(predictedMedianS) && predictedMedianS > 0
  if (!hasHarvested && !hasPredicted) return { baselineS: null, source: null }
  if (!hasPredicted) return { baselineS: harvestedMedianS, source: 'harvested' }
  if (!hasHarvested) return { baselineS: predictedMedianS, source: 'predicted' }
  const w = credibilityWeight(harvestedWeekdayDays, k)
  return { baselineS: Math.round(w * harvestedMedianS + (1 - w) * predictedMedianS), source: 'blended' }
}

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation (|err| < 1.5e-7). */
export function normCdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2)
  const y =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const erf = 1 - y * Math.exp(-(x * x) / 2)
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf)
}

/**
 * Lognormal sigma implied by treating OPTIMISTIC/PESSIMISTIC as symmetric
 * quantiles at standard-normal offset z: sigma = ln(pess/opt) / (2z).
 */
export function sigmaFromEnvelope(optS, pessS, z) {
  if (!Number.isFinite(optS) || !Number.isFinite(pessS) || optS <= 0 || pessS <= optS) return null
  if (!Number.isFinite(z) || z <= 0) return null
  return Math.log(pessS / optS) / (2 * z)
}

/** P(duration > baseline * (1 + threshold/100)) under lognormal(muLog, sigma). */
export function breachProbability({ baselineS, thresholdPct, muLog, sigma }) {
  if (!Number.isFinite(baselineS) || baselineS <= 0) return null
  if (!Number.isFinite(muLog) || !Number.isFinite(sigma) || sigma == null || sigma <= 0) return null
  const cutoff = Math.log(baselineS * (1 + thresholdPct / 100))
  return 1 - normCdf((cutoff - muLog) / sigma)
}
