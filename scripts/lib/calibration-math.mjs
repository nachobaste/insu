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

/**
 * Beta-Binomial credibility posterior:
 *   pPost = (priorDays * pModel + breachDays) / (priorDays + totalDays)
 * With no model prior, falls back to the raw observed frequency (null if no data).
 */
export function betaBlend({ pModel, priorDays, breachDays, totalDays }) {
  const hasModel = Number.isFinite(pModel)
  if (!hasModel) return totalDays > 0 ? breachDays / totalDays : null
  return (priorDays * pModel + breachDays) / (priorDays + totalDays)
}

/**
 * Grid-search the single global quantile offset z so that the reading-day-weighted
 * pooled model breach rate matches the pooled measured breach rate.
 * corridors: [{ optS, pessS, bestS, baselineS, thresholdPct, breachDays, totalDays }]
 * Only corridors with a valid envelope, a baseline, and totalDays >= minDays participate.
 */
export function fitZ(corridors, { zMin = 0.5, zMax = 2.5, zStep = 0.01, minDays = 7 } = {}) {
  const usable = (corridors ?? []).filter(
    (c) =>
      Number.isFinite(c.optS) && Number.isFinite(c.pessS) && Number.isFinite(c.bestS) &&
      c.optS > 0 && c.pessS > c.optS && c.bestS > 0 &&
      Number.isFinite(c.baselineS) && c.baselineS > 0 &&
      Number.isFinite(c.totalDays) && c.totalDays >= minDays,
  )
  if (usable.length === 0) return { z: null, pooledMeasured: null, pooledModel: null }

  const totalN = usable.reduce((a, c) => a + c.totalDays, 0)
  const pooledMeasured = usable.reduce((a, c) => a + c.breachDays, 0) / totalN

  const pooledModelAt = (z) =>
    usable.reduce((acc, c) => {
      const sigma = sigmaFromEnvelope(c.optS, c.pessS, z)
      const p = breachProbability({
        baselineS: c.baselineS, thresholdPct: c.thresholdPct, muLog: Math.log(c.bestS), sigma,
      })
      return acc + (p ?? 0) * c.totalDays
    }, 0) / totalN

  let best = { z: null, diff: Infinity, pooledModel: null }
  for (let z = zMin; z <= zMax + 1e-9; z += zStep) {
    const pm = pooledModelAt(z)
    const diff = Math.abs(pm - pooledMeasured)
    if (diff < best.diff) best = { z: Math.round(z * 100) / 100, diff, pooledModel: pm }
  }
  return { z: best.z, pooledMeasured, pooledModel: best.pooledModel }
}
