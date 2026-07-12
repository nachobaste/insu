'use server'

import { createClient } from '@/lib/supabase/server'
import { dailyHazard, valuePosition } from '@/lib/pricing/derivative'
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
      .select('*, contract:contracts(id, slug, title, trigger_type, status, is_recurring, trigger_condition, corridor:corridors(window_start, window_end)), tier:coverage_tiers(name, base_probability, max_payouts)')
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
  // RLS also hides cancelled contracts entirely, in which case the join comes
  // back null — treat that the same way (the cards can't render without one).
  const notCancelled = (row: { contract?: { status?: string } | null }) =>
    row.contract != null && row.contract.status !== 'cancelled'

  const hedgerPositions = ((hedgerResult.data ?? []) as HedgerPositionWithContract[]).filter(notCancelled)

  // Compute live mark-to-market value for active positions on recurring contracts.
  try {
    const activeRecurring = hedgerPositions.filter(
      p => p.status === 'active' && p.contract?.is_recurring,
    )
    if (activeRecurring.length > 0) {
      const ids = [...new Set(activeRecurring.map(p => p.contract_id))]
      const { data: readings } = await supabase
        .from('oracle_readings')
        .select('contract_id, value, read_at')
        .in('contract_id', ids)
        .order('read_at', { ascending: false })

      const latestByContract = new Map<string, { value: Record<string, unknown> }>()
      for (const row of readings ?? []) {
        if (!latestByContract.has(row.contract_id)) {
          latestByContract.set(row.contract_id, { value: row.value as Record<string, unknown> })
        }
      }

      for (const pos of activeRecurring) {
        try {
          const remainingDays = Math.max(
            0,
            (new Date(pos.expires_at).getTime() - Date.now()) / 86_400_000,
          )
          const reading = latestByContract.get(pos.contract_id) ?? null
          const p = dailyHazard(
            pos.tier.base_probability,
            reading ? { value: reading.value } : null,
            pos.contract.trigger_condition as never,
          )
          pos.current_value_usd = valuePosition(
            pos.payout_amount_usd,
            remainingDays,
            p,
            pos.payouts_remaining ?? pos.tier.max_payouts,
          )
        } catch {
          pos.current_value_usd = null
        }
      }
    }
  } catch {
    // If oracle fetch fails entirely, positions keep current_value_usd undefined.
  }

  return {
    hedgerPositions,
    providerPositions: ((providerResult.data ?? []) as ProviderPositionWithContract[]).filter(notCancelled),
    payouts: ((payoutsResult.data ?? []) as PayoutWithContract[]).filter(notCancelled),
  }
}
