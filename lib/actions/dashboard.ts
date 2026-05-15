'use server'

import { createClient } from '@/lib/supabase/server'
import type {
  HedgerPositionWithContract,
  ProviderPositionWithContract,
  PayoutWithContract,
} from '@/lib/types'

export interface DashboardData {
  hedgerPositions: HedgerPositionWithContract[]
  providerPositions: ProviderPositionWithContract[]
  payouts: PayoutWithContract[]
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const supabase = createClient()

  const [hedgerResult, providerResult, payoutsResult] = await Promise.all([
    supabase
      .from('hedger_positions')
      .select('*, contract:contracts(id, slug, title, trigger_type), tier:coverage_tiers(name)')
      .eq('user_id', userId)
      .in('status', ['active', 'paid_out', 'expired']),
    supabase
      .from('provider_positions')
      .select('*, contract:contracts(id, slug, title, trigger_type, trigger_deadline), tier:coverage_tiers(name)')
      .eq('user_id', userId)
      .in('status', ['active', 'settled']),
    // !inner join excludes payouts with no hedger_position; .eq filters to this user's positions only
    supabase
      .from('payouts')
      .select('*, contract:contracts(id, slug, title), hedger_position:hedger_positions!inner(user_id)')
      .eq('hedger_position.user_id', userId)
      .order('created_at', { ascending: false }),
  ])

  if (hedgerResult.error) throw hedgerResult.error
  if (providerResult.error) throw providerResult.error
  if (payoutsResult.error) throw payoutsResult.error

  return {
    hedgerPositions: (hedgerResult.data ?? []) as HedgerPositionWithContract[],
    providerPositions: (providerResult.data ?? []) as ProviderPositionWithContract[],
    payouts: (payoutsResult.data ?? []) as PayoutWithContract[],
  }
}
