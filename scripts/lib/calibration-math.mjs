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
