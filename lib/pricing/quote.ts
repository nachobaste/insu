import { dailyHazard, priceTenor, capacityFactor } from '@/lib/pricing/derivative'
import type { CoverageTier, LatestOracleReading } from '@/lib/types'

/** Live premium per tier id for a given tenor, using the latest oracle reading. */
export function quoteTiers(
  tiers: CoverageTier[],
  tenorDays: number,
  triggerCondition: Record<string, unknown>,
  reading: LatestOracleReading | null,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of tiers) {
    const p = dailyHazard(
      t.base_probability,
      reading ? { value: reading.value } : null,
      triggerCondition as never,
    )
    const cap = capacityFactor(t.current_capacity_usd, t.max_capacity_usd)
    out[t.id] = priceTenor(t.payout_usd, tenorDays, p, t.max_payouts, { capacityFactor: cap }).premiumUsd
  }
  return out
}
