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

export async function getDashboardData(userId?: string): Promise<DashboardData> {
  const supabase = await createClient()

  if (!userId) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Unauthorized')
    userId = user.id
  }

  const [hedgerResult, providerResult, payoutsResult] = await Promise.all([
    supabase
      .from('hedger_positions')
      .select('*, contract:contracts(id, slug, title, trigger_type, status), tier:coverage_tiers(name)')
      .eq('user_id', userId)
      .in('status', ['active', 'paid_out', 'expired']),
    supabase
      .from('provider_positions')
      .select('*, contract:contracts(id, slug, title, trigger_type, trigger_deadline, status), tier:coverage_tiers(name)')
      .eq('user_id', userId)
      .in('status', ['active', 'settled']),
    // !inner join excludes payouts with no hedger_position; .eq filters to this user's positions only
    supabase
      .from('payouts')
      .select('*, contract:contracts(id, slug, title, status), hedger_position:hedger_positions!inner(user_id)')
      .eq('hedger_position.user_id', userId)
      .order('created_at', { ascending: false }),
  ])

  if (hedgerResult.error) throw hedgerResult.error
  if (providerResult.error) throw providerResult.error
  if (payoutsResult.error) throw payoutsResult.error

  // Cancelled markets are removed from the platform, so hide their positions and
  // payouts here even though the position rows themselves remain in the database.
  const notCancelled = (row: { contract?: { status?: string } | null }) =>
    row.contract?.status !== 'cancelled'

  return {
    hedgerPositions: ((hedgerResult.data ?? []) as HedgerPositionWithContract[]).filter(notCancelled),
    providerPositions: ((providerResult.data ?? []) as ProviderPositionWithContract[]).filter(notCancelled),
    payouts: ((payoutsResult.data ?? []) as PayoutWithContract[]).filter(notCancelled),
  }
}
