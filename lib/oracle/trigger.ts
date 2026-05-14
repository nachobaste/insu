export interface TriggerCondition {
  metric: string
  threshold: number
  operator: 'gte' | 'lte' | 'gt' | 'lt'
}

export function evaluateTrigger(
  condition: TriggerCondition,
  value: Record<string, unknown>,
): boolean {
  const actual = value[condition.metric]
  if (typeof actual !== 'number') return false
  switch (condition.operator) {
    case 'gte': return actual >= condition.threshold
    case 'lte': return actual <= condition.threshold
    case 'gt':  return actual > condition.threshold
    case 'lt':  return actual < condition.threshold
  }
}
