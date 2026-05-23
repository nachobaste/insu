import type { TriggerCondition } from './trigger'

const MIN_MULTIPLIER = 0.3
const MAX_MULTIPLIER = 3.0

export function computeOracleMultiplier(
  reading: { value: Record<string, unknown> },
  condition: TriggerCondition,
): number {
  if (condition.threshold === 0) return 1.0

  const actual = reading.value[condition.metric]
  if (typeof actual !== 'number' || !isFinite(actual)) return 1.0

  const proximity =
    condition.operator === 'gte' || condition.operator === 'gt'
      ? actual / condition.threshold
      : condition.threshold / actual

  return Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, proximity))
}
