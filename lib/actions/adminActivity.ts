'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { buildUserActivity, type UserActivity, type ActivityInputs } from '@/lib/admin/activity'

/**
 * Aggregates every profile's F&F journey. Uses the service client because it
 * reads user-owned tables (RLS would return empty for an admin). Payouts carry
 * no user_id, so they are joined through hedger_positions.user_id.
 */
export async function getUserActivity(): Promise<UserActivity[]> {
  const db = createServiceClient()

  const [profilesRes, buysRes, depositsRes, payoutsRes, usersRes] = await Promise.all([
    db.from('profiles').select('id, full_name, created_at, active_days, last_seen_at'),
    db.from('hedger_positions').select('user_id, status, purchased_at, premium_paid_usd, coverage_period_days, contract:contracts(title), tier:coverage_tiers(name)'),
    db.from('provider_positions').select('user_id, deposited_at, capital_deposited_usd, contract:contracts(title)'),
    db.from('payouts').select('amount_usd, created_at, trigger_day, hedger_position:hedger_positions(user_id)'),
    db.auth.admin.listUsers(),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asArr = (x: any) => (Array.isArray(x) ? x : [])

  const inputs: ActivityInputs = {
    profiles: asArr(profilesRes.data).map((p: Record<string, unknown>) => ({
      id: p.id as string,
      full_name: (p.full_name as string) ?? null,
      created_at: p.created_at as string,
      active_days: (p.active_days as number) ?? 0,
      last_seen_at: (p.last_seen_at as string) ?? null,
    })),
    authUsers: (usersRes.data?.users ?? []).map((u) => ({ id: u.id, email: u.email ?? null })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    buys: asArr(buysRes.data).map((b: Record<string, any>) => ({
      user_id: b.user_id,
      status: b.status,
      purchased_at: b.purchased_at,
      premium_paid_usd: Number(b.premium_paid_usd ?? 0),
      coverage_period_days: b.coverage_period_days ?? null,
      contract_title: b.contract?.title ?? null,
      tier_name: b.tier?.name ?? null,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deposits: asArr(depositsRes.data).map((d: Record<string, any>) => ({
      user_id: d.user_id,
      deposited_at: d.deposited_at,
      capital_deposited_usd: Number(d.capital_deposited_usd ?? 0),
      contract_title: d.contract?.title ?? null,
    })),
    payouts: asArr(payoutsRes.data)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: Record<string, any>) => ({
        user_id: p.hedger_position?.user_id as string | undefined,
        created_at: p.created_at,
        amount_usd: Number(p.amount_usd ?? 0),
        trigger_day: p.trigger_day ?? null,
      }))
      .filter((p): p is { user_id: string; created_at: string; amount_usd: number; trigger_day: string | null } => !!p.user_id),
  }

  return buildUserActivity(inputs)
}
