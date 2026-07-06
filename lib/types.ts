// lib/types.ts

export type CategoryName = 'Urban' | 'Nature' | 'Experiences' | 'Events'
export type ContractStatus = 'active' | 'settled' | 'cancelled' | 'pending'
export type TriggerType = 'weather' | 'urban' | 'event' | 'manual' | 'fuel' | 'air_quality' | 'flood'
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
  max_payouts: number
  last_priced_at: string | null
  pricing_inputs: Record<string, unknown> | null
}

export interface ContractLocation {
  lat: number
  lng: number
  city: string
  country: string
}

export interface Corridor {
  id: string
  slug: string
  name: string
  road: string
  origin_lat: number
  origin_lng: number
  dest_lat: number
  dest_lng: number
  window_start: string  // 'HH:MM:SS' from PostgreSQL TIME
  window_end: string
  baseline_duration_s: number | null  // typical in-window seconds; NULL = no baseline yet
  path_polyline: string | null  // encoded road-route polyline; NULL = not backfilled yet
  created_at: string
}

export type LaunchStage = 'live' | 'coming_soon'

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
  trigger_deadline: string | null
  is_recurring: boolean
  location: ContractLocation
  icon_url: string | null
  total_volume_usd: number
  total_volume_mxn: number
  is_featured: boolean
  launch_stage: LaunchStage
  settled_outcome: boolean | null
  created_by: string
  created_at: string
  settled_at: string | null
  coverage_tiers?: CoverageTier[]
  corridor?: Corridor | null
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
  coverage_period_days?: number | null
  payouts_remaining?: number | null
  payouts_made?: number
  last_payout_date?: string | null
  reserved_usd?: number | null
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
  source: 'openweathermap' | 'tomorrow_io' | 'google_maps' | 'manual' | 'cre_datos_gob' | 'sedema'
  reading_type: string
  value: Record<string, unknown>
  trigger_met: boolean
  read_at: string
}

export interface LatestOracleReading {
  value: Record<string, unknown>
  read_at: string
  source: 'openweathermap' | 'tomorrow_io' | 'google_maps' | 'manual' | 'cre_datos_gob' | 'sedema'
  trigger_met: boolean
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

export interface HedgerPositionWithContract extends HedgerPosition {
  contract: Pick<Contract, 'id' | 'slug' | 'title' | 'trigger_type' | 'status' | 'is_recurring' | 'trigger_condition'>
  tier: Pick<CoverageTier, 'name' | 'base_probability' | 'max_payouts'>
  current_value_usd?: number | null
}

export interface ProviderPositionWithContract extends ProviderPosition {
  contract: Pick<Contract, 'id' | 'slug' | 'title' | 'trigger_type' | 'trigger_deadline' | 'status'>
  tier: Pick<CoverageTier, 'name'>
}

export interface PayoutWithContract extends Payout {
  contract: Pick<Contract, 'id' | 'slug' | 'title' | 'status'>
}

export interface AdminAuditLog {
  id: string
  admin_id: string
  action: string
  contract_id: string | null
  payout_id: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface UpsertContractInput {
  id?: string
  title: string
  description: string | null
  category_id: string
  status: ContractStatus
  trigger_type: TriggerType
  trigger_condition: Record<string, unknown>
  trigger_deadline: string | null
  is_recurring: boolean
  location: ContractLocation
  icon_url: string | null
  is_featured: boolean
  launch_stage: LaunchStage
  basic_tier: { premium_usd: number; payout_usd: number; max_capacity_usd: number }
  premium_tier: { premium_usd: number; payout_usd: number; max_capacity_usd: number }
  // For corridor (urban) contracts: edit the linked corridor's route endpoints.
  // Saving re-fetches the road polyline so the map redraws the corrected route.
  corridor?: {
    id: string
    origin_lat: number
    origin_lng: number
    dest_lat: number
    dest_lng: number
  }
}

export type NotificationType =
  | 'coverage_paid'
  | 'coverage_expired'
  | 'protection_purchased'
  | 'provider_settled'
  | 'product_launched'

export interface NotificationPrefs {
  coverage_paid: boolean
  coverage_expired: boolean
  protection_purchased: boolean
  provider_settled: boolean
  product_launched: boolean
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  coverage_paid: true,
  coverage_expired: true,
  protection_purchased: true,
  provider_settled: true,
  product_launched: true,
}

export interface Notification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string
  contract_id: string | null
  read_at: string | null
  created_at: string
  // Optional joined contract for deep-linking from the bell dropdown
  contract?: { slug: string } | null
}
