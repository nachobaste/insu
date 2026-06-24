// Validates that the provider pool has room for a new deposit.
export function validateProviderCapacity(
  maxCapacity: number,
  currentCapacity: number,
  depositAmount: number,
): string | null {
  const remaining = maxCapacity - currentCapacity
  if (remaining <= 0) return 'This tier is at capacity'
  if (depositAmount > remaining) return `Maximum available: $${remaining.toLocaleString()} USD`
  return null
}

// Validates that the provider pool is large enough to cover a buyer's payout.
export function validateBuyerCapacity(poolSize: number, payoutAmount: number): string | null {
  if (poolSize <= 0) return 'No capital in pool yet — check back soon'
  if (payoutAmount > poolSize) return 'Pool capacity too low to cover this tier\'s payout'
  return null
}
