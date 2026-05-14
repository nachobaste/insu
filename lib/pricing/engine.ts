import type { CoverageTier, Contract } from '@/lib/types'

const LOADING_FACTOR = 1.15

export interface PricingInputs {
  utilization: number
  daysRemaining: number
  utilizationFactor: number
  timeFactor: number
  loadingFactor: number
}

export interface PricingResult {
  premiumUsd: number
  inputs: PricingInputs
}

export function priceTier(tier: CoverageTier, contract: Contract): PricingResult {
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

  const premiumUsd = tier.payout_usd * tier.base_probability * utilizationFactor * timeFactor * loadingFactor

  return {
    premiumUsd: Math.round(premiumUsd * 100) / 100,
    inputs: { utilization, daysRemaining, utilizationFactor, timeFactor, loadingFactor },
  }
}
