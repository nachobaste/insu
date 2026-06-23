/** Hard cap on the traffic index (percent slower than baseline). Prevents a
 *  single spike from dominating the oracle multiplier downstream. */
export const TRAFFIC_INDEX_MAX = 100

/**
 * Traffic index = how much slower the live trip is than `baselineS`, as a
 * clamped, rounded percentage in [0, TRAFFIC_INDEX_MAX].
 *
 * `baselineS` is the corridor's typical in-window duration. Callers pass Google's
 * free-flow `staticDuration` as a fallback until a typical baseline exists, which
 * reproduces the historical behavior exactly.
 *
 * Non-positive or NaN `durationS` floors to 0 via the clamp; the result is
 * rounded to the nearest integer.
 */
export function trafficIndex(durationS: number, baselineS: number): number {
  if (!baselineS || baselineS <= 0) return 0
  const raw = ((durationS / baselineS) - 1) * 100
  return Math.min(TRAFFIC_INDEX_MAX, Math.max(0, Math.round(raw)))
}
