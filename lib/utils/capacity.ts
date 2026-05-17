export function validateCapacity(
  maxCapacity: number,
  currentCapacity: number,
  requestedAmount: number,
): string | null {
  const remaining = maxCapacity - currentCapacity
  if (remaining <= 0) return 'This tier is at capacity'
  if (requestedAmount > remaining) return `Maximum available: $${remaining.toLocaleString()}`
  return null
}
