import type { CoverageTier, Contract } from '@/lib/types'

const LOADING_FACTOR = 1.15

export interface PricingInputs {
  utilization: number
  daysRemaining: number
  utilizationFactor: number
  timeFactor: number
  loadingFactor: number
  oracleMultiplier: number
}

export interface PricingResult {
  premiumUsd: number
  inputs: PricingInputs
}

export function priceTier(
  tier: CoverageTier,
  contract: Contract,
  oracleMultiplier = 1.0,
): PricingResult {
  const utilization = tier.max_capacity_usd > 0
    ? tier.current_capacity_usd / tier.max_capacity_usd
    : 0

  const daysRemaining = Math.max(
    0,
    (new Date(contract.trigger_deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  )

  const utilizationFactor = 1 + 0.5 * utilization
  const timeFactor = 1 + 0.5 * Math.max(0, 1 - daysRemaining / 30)
  const loadingFactor = LOADING_FACTOR

  const safeMultiplier = Number.isFinite(oracleMultiplier) && oracleMultiplier > 0
    ? oracleMultiplier
    : 1.0

  const premiumUsd = tier.payout_usd * tier.base_probability * safeMultiplier * utilizationFactor * timeFactor * loadingFactor

  return {
    premiumUsd: Math.round(premiumUsd * 100) / 100,
    inputs: { utilization, daysRemaining, utilizationFactor, timeFactor, loadingFactor, oracleMultiplier: safeMultiplier },
  }
}

export function computePeriodFactor(
  periodDays: number,
  contract: Pick<Contract, 'created_at' | 'trigger_deadline'>,
): number {
  const contractDays =
    (new Date(contract.trigger_deadline).getTime() - new Date(contract.created_at).getTime()) /
    86_400_000
  if (contractDays <= 0) return 1.0
  return Math.min(1.0, periodDays / contractDays)
}
