// lib/types.ts

export type CategoryName = 'Urban' | 'Nature' | 'Experiences' | 'Events'
export type ContractStatus = 'active' | 'settled' | 'cancelled' | 'pending'
export type TriggerType = 'weather' | 'urban' | 'event' | 'manual'
export type CoverageLevel = 'basic' | 'premium'
export type Currency = 'USD' | 'MXN'
export type UserRole = 'hedger' | 'provider' | 'admin' | 'both'

export interface Category {
  id: string
  name: CategoryName
  slug: string
  color: string
  icon_url: string | null
  display_order: number
}

export interface CoverageTier {
  id: string
  contract_id: string
  name: CoverageLevel
  premium_usd: number
  payout_usd: number
  premium_mxn: number
  payout_mxn: number
  max_capacity_usd: number
  current_capacity_usd: number
  base_probability: number
  last_priced_at: string | null
  pricing_inputs: Record<string, unknown> | null
}

export interface ContractLocation {
  lat: number
  lng: number
  city: string
  country: string
}

export interface Contract {
  id: string
  slug: string
  title: string
  description: string | null
  category_id: string
  category?: Category
  status: ContractStatus
  trigger_type: TriggerType
  trigger_condition: Record<string, unknown>
  trigger_deadline: string
  location: ContractLocation
  icon_url: string | null
  total_volume_usd: number
  total_volume_mxn: number
  is_featured: boolean
  settled_outcome: boolean | null
  created_by: string
  created_at: string
  settled_at: string | null
  coverage_tiers?: CoverageTier[]
}

export interface ContractWithTiers extends Contract {
  coverage_tiers: CoverageTier[]
  category: Category
}

export interface PricingHistoryRow {
  id: string
  tier_id: string
  premium_usd_after: number
  calculated_at: string
}

export interface ContractDetailData extends ContractWithTiers {
  pricing_history: PricingHistoryRow[]
}

export interface HedgerPosition {
  id: string
  user_id: string
  contract_id: string
  tier_id: string
  premium_paid_usd: number
  payout_amount_usd: number
  premium_paid_mxn: number
  payout_amount_mxn: number
  currency: string
  payment_provider: string
  payment_intent_id: string | null
  status: string
  purchased_at: string
  expires_at: string
}

export interface ProviderPosition {
  id: string
  user_id: string
  contract_id: string
  tier_id: string
  capital_deposited_usd: number
  capital_deposited_mxn: number
  currency: string
  payment_provider: string
  payment_intent_id: string | null
  expected_return_usd: number
  actual_return_usd: number | null
  expected_return_mxn: number
  actual_return_mxn: number | null
  status: string
  deposited_at: string
  settled_at: string | null
}

export interface OracleReading {
  id: string
  contract_id: string
  source: 'openweathermap' | 'tomorrow_io' | 'waze' | 'manual'
  reading_type: string
  value: Record<string, unknown>
  trigger_met: boolean
  read_at: string
}

export interface Payout {
  id: string
  contract_id: string
  hedger_position_id: string
  amount_usd: number
  amount_mxn: number
  currency: string
  payment_provider: string
  transfer_id: string | null
  status: string
  created_at: string
  completed_at: string | null
}
