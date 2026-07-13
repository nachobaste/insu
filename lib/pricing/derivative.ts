import { computeOracleMultiplier } from '@/lib/oracle/multiplier'
import type { TriggerCondition } from '@/lib/oracle/trigger'

export const P_MIN = 0.0005
export const P_MAX = 0.95
export const LOADING_FACTOR = 1.15
/**
 * A premium is never quoted above this fraction of the position's MAX possible
 * payout (payout × maxPayouts). Keeps long tenors coherent: without it, a
 * non-trivial daily hazard over 30 days pushes the fair premium toward — and
 * past — the payout itself, which no rational hedger would buy.
 */
export const MAX_PREMIUM_FRACTION = 0.70

/**
 * P(N >= k) where N ~ Binomial(T, p) — probability of at least k trigger-days
 * in a T-day window. Cumulative lower tail via the stable term recurrence
 * term_j = term_{j-1} * (T-j+1)/j * p/(1-p).
 */
export function probAtLeastK(T: number, p: number, k: number): number {
  if (k <= 0) return 1
  if (T <= 0 || p <= 0) return 0
  if (p >= 1) return 1
  if (k > T) return 0
  let term = Math.pow(1 - p, T) // j = 0
  let cdf = term
  for (let j = 1; j < k; j++) {
    term = (term * (T - j + 1) / j) * (p / (1 - p))
    cdf += term
  }
  return Math.max(0, Math.min(1, 1 - cdf))
}

/**
 * Oracle multiplier for recurring window contracts. base_probability is already
 * the calibrated daily window probability, so an off-window snapshot must not
 * discount it (a sub-1.0 proximity double-counts and pinned every recurring
 * premium to the 0.3 floor). Only the >1x near-trigger upside is kept, as
 * adverse-selection protection. One-time contracts keep the full multiplier
 * via the legacy priceTier path.
 */
export function recurringOracleMultiplier(
  reading: { value: Record<string, unknown> } | null,
  condition: TriggerCondition,
): number {
  return reading ? Math.max(1, computeOracleMultiplier(reading, condition)) : 1.0
}

/** Daily probability the trigger fires: clamp(base x oracleMultiplier). */
export function dailyHazard(
  baseProbability: number,
  reading: { value: Record<string, unknown> } | null,
  condition: TriggerCondition,
): number {
  const raw = baseProbability * recurringOracleMultiplier(reading, condition)
  return Math.min(P_MAX, Math.max(P_MIN, raw))
}

export interface TenorPriceInputs {
  p: number
  tenorDays: number
  maxPayouts: number
  loading: number
  capacityFactor: number
  expectedPayouts: number
}
export interface TenorPriceResult {
  premiumUsd: number
  inputs: TenorPriceInputs
}

/** Bounded supply/demand surcharge: 1.0x (empty) -> 1.5x (full). */
export function capacityFactor(currentCapacityUsd: number, maxCapacityUsd: number): number {
  const utilization = maxCapacityUsd > 0 ? currentCapacityUsd / maxCapacityUsd : 0
  return Math.min(1.5, 1 + 0.5 * Math.max(0, utilization))
}

/**
 * Premium for a fresh position of `tenorDays`, paying up to `maxPayouts` times.
 * Basic = maxPayouts 1 (one-touch); Pro = maxPayouts 3 (capped strip).
 * premium = payout x (sum_{k=1..maxPayouts} P(N>=k)) x loading x capacityFactor.
 */
export function priceTenor(
  payoutUsd: number,
  tenorDays: number,
  p: number,
  maxPayouts: number,
  opts: { loading?: number; capacityFactor?: number } = {},
): TenorPriceResult {
  const loading = opts.loading ?? LOADING_FACTOR
  const cap = opts.capacityFactor ?? 1.0
  let expectedPayouts = 0
  for (let k = 1; k <= maxPayouts; k++) {
    expectedPayouts += probAtLeastK(tenorDays, p, k)
  }
  const rawPremiumUsd = payoutUsd * expectedPayouts * loading * cap
  const maxPremiumUsd = payoutUsd * maxPayouts * MAX_PREMIUM_FRACTION
  const premiumUsd = Math.round(Math.min(rawPremiumUsd, maxPremiumUsd) * 100) / 100
  return { premiumUsd, inputs: { p, tenorDays, maxPayouts, loading, capacityFactor: cap, expectedPayouts } }
}

/**
 * Fair (mid) value of an open position — NO loading, NO capacity factor.
 * V = payout x sum_{k=1..payoutsRemaining} P(N_remaining >= k | pNow).
 */
export function valuePosition(
  payoutUsd: number,
  remainingDays: number,
  pNow: number,
  payoutsRemaining: number,
): number {
  if (remainingDays <= 0 || payoutsRemaining <= 0) return 0
  let expected = 0
  for (let k = 1; k <= payoutsRemaining; k++) {
    expected += probAtLeastK(remainingDays, pNow, k)
  }
  return Math.round(payoutUsd * expected * 100) / 100
}
