export type TesterStatus =
  | 'completed_loop'
  | 'holding'
  | 'abandoned_checkout'
  | 'signed_up_idle'
  | 'active_other'

export interface ProfileRow {
  id: string
  full_name: string | null
  created_at: string
  login_count: number
  last_login_at: string | null
}
export interface AuthUserRow { id: string; email: string | null }
export interface BuyRow {
  user_id: string
  status: string
  purchased_at: string
  premium_paid_usd: number
  coverage_period_days: number | null
  contract_title: string | null
  tier_name: string | null
}
export interface DepositRow {
  user_id: string
  deposited_at: string
  capital_deposited_usd: number
  contract_title: string | null
}
export interface PayoutRow {
  user_id: string
  created_at: string
  amount_usd: number
  trigger_day: string | null
}

export interface ActivityInputs {
  profiles: ProfileRow[]
  authUsers: AuthUserRow[]
  buys: BuyRow[]
  deposits: DepositRow[]
  payouts: PayoutRow[]
}

export interface TimelineItem {
  at: string
  kind: 'signup' | 'buy' | 'deposit' | 'payout'
  primary: string
  amountUsd?: number
  meta?: string
}

export interface UserActivity {
  userId: string
  name: string | null
  email: string | null
  createdAt: string
  loginCount: number
  lastLoginAt: string | null
  buys: BuyRow[]
  deposits: DepositRow[]
  payouts: PayoutRow[]
  totalPremiumUsd: number
  totalPayoutUsd: number
  status: TesterStatus
  lastActivityAt: string
  timeline: TimelineItem[]
}

/** Most-advanced status wins: paid out > holding > abandoned checkout > idle > other. */
export function deriveTesterStatus(r: {
  buys: { status: string }[]
  deposits: unknown[]
  payouts: unknown[]
}): TesterStatus {
  if (r.payouts.length > 0) return 'completed_loop'
  if (r.buys.some((b) => b.status === 'active')) return 'holding'
  if (r.buys.some((b) => b.status === 'pending_payment')) return 'abandoned_checkout'
  if (r.buys.length === 0 && r.deposits.length === 0) return 'signed_up_idle'
  return 'active_other'
}

function maxIso(...isos: (string | null | undefined)[]): string {
  return isos.filter((x): x is string => !!x).sort().at(-1) ?? ''
}

export function buildUserActivity(inputs: ActivityInputs): UserActivity[] {
  const emailById = new Map(inputs.authUsers.map((u) => [u.id, u.email]))
  const buysById = groupBy(inputs.buys, (b) => b.user_id)
  const depositsById = groupBy(inputs.deposits, (d) => d.user_id)
  const payoutsById = groupBy(inputs.payouts, (p) => p.user_id)

  const out = inputs.profiles.map((p): UserActivity => {
    const buys = buysById.get(p.id) ?? []
    const deposits = depositsById.get(p.id) ?? []
    const payouts = payoutsById.get(p.id) ?? []

    const timeline: TimelineItem[] = [
      { at: p.created_at, kind: 'signup', primary: 'Signed up' },
      ...buys.map((b): TimelineItem => ({
        at: b.purchased_at,
        kind: 'buy',
        primary: b.contract_title ?? 'Protection',
        amountUsd: b.premium_paid_usd,
        meta: [b.tier_name, b.coverage_period_days ? `${b.coverage_period_days}d` : null, b.status]
          .filter(Boolean).join(' · '),
      })),
      ...deposits.map((d): TimelineItem => ({
        at: d.deposited_at,
        kind: 'deposit',
        primary: d.contract_title ?? 'Capital deposit',
        amountUsd: d.capital_deposited_usd,
      })),
      ...payouts.map((pay): TimelineItem => ({
        at: pay.created_at,
        kind: 'payout',
        primary: 'Payout received',
        amountUsd: pay.amount_usd,
        meta: pay.trigger_day ? `trigger ${pay.trigger_day}` : undefined,
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

    return {
      userId: p.id,
      name: p.full_name,
      email: emailById.get(p.id) ?? null,
      createdAt: p.created_at,
      loginCount: p.login_count,
      lastLoginAt: p.last_login_at,
      buys, deposits, payouts,
      totalPremiumUsd: round2(buys.reduce((s, b) => s + b.premium_paid_usd, 0)),
      totalPayoutUsd: round2(payouts.reduce((s, p2) => s + p2.amount_usd, 0)),
      status: deriveTesterStatus({ buys, deposits, payouts }),
      lastActivityAt: maxIso(
        p.last_login_at, p.created_at,
        ...buys.map((b) => b.purchased_at),
        ...deposits.map((d) => d.deposited_at),
        ...payouts.map((p2) => p2.created_at),
      ),
      timeline,
    }
  })

  return out.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0))
}

function groupBy<T>(rows: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const arr = m.get(k)
    if (arr) arr.push(r)
    else m.set(k, [r])
  }
  return m
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
