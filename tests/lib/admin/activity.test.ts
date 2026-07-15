import { describe, it, expect } from 'vitest'
import { deriveTesterStatus, buildUserActivity } from '@/lib/admin/activity'
import type { ActivityInputs } from '@/lib/admin/activity'

const base = {
  profiles: [{ id: 'u1', full_name: 'Ada', created_at: '2026-07-01T00:00:00Z', login_count: 3, last_login_at: '2026-07-05T00:00:00Z' }],
  authUsers: [{ id: 'u1', email: 'ada@example.com' }],
  buys: [], deposits: [], payouts: [],
} satisfies ActivityInputs

describe('deriveTesterStatus', () => {
  it('completed_loop when a payout exists (trumps all)', () => {
    expect(deriveTesterStatus({ buys: [{ status: 'active' }], deposits: [], payouts: [{}] })).toBe('completed_loop')
  })
  it('holding when an active buy and no payout', () => {
    expect(deriveTesterStatus({ buys: [{ status: 'active' }], deposits: [], payouts: [] })).toBe('holding')
  })
  it('abandoned_checkout when only a pending_payment buy', () => {
    expect(deriveTesterStatus({ buys: [{ status: 'pending_payment' }], deposits: [], payouts: [] })).toBe('abandoned_checkout')
  })
  it('signed_up_idle with no positions at all', () => {
    expect(deriveTesterStatus({ buys: [], deposits: [], payouts: [] })).toBe('signed_up_idle')
  })
  it('active_other for a provider-only deposit', () => {
    expect(deriveTesterStatus({ buys: [], deposits: [{}], payouts: [] })).toBe('active_other')
  })
})

describe('buildUserActivity', () => {
  it('rolls up an idle signed-up user', () => {
    const [a] = buildUserActivity(base)
    expect(a).toMatchObject({ userId: 'u1', name: 'Ada', email: 'ada@example.com', loginCount: 3, status: 'signed_up_idle', totalPremiumUsd: 0, totalPayoutUsd: 0 })
    expect(a.timeline).toHaveLength(1)
    expect(a.timeline[0].kind).toBe('signup')
  })

  it('sums premiums/payouts and builds a reverse-chronological timeline', () => {
    const inputs: ActivityInputs = {
      ...base,
      buys: [{ user_id: 'u1', status: 'active', purchased_at: '2026-07-02T00:00:00Z', premium_paid_usd: 11.5, coverage_period_days: 7, contract_title: 'Heat wave', tier_name: 'basic' }],
      payouts: [{ user_id: 'u1', created_at: '2026-07-04T00:00:00Z', amount_usd: 100, trigger_day: '2026-07-04' }],
    }
    const [a] = buildUserActivity(inputs)
    expect(a.totalPremiumUsd).toBeCloseTo(11.5, 2)
    expect(a.totalPayoutUsd).toBe(100)
    expect(a.status).toBe('completed_loop')
    // reverse chronological: payout (07-04) before buy (07-02) before signup (07-01)
    expect(a.timeline.map((t) => t.kind)).toEqual(['payout', 'buy', 'signup'])
    expect(a.lastActivityAt).toBe('2026-07-05T00:00:00Z') // last_login is latest
  })

  it('groups rows by user and sorts users by most recent activity', () => {
    const inputs: ActivityInputs = {
      profiles: [
        { id: 'u1', full_name: 'Ada', created_at: '2026-07-01T00:00:00Z', login_count: 1, last_login_at: '2026-07-01T00:00:00Z' },
        { id: 'u2', full_name: 'Bea', created_at: '2026-07-02T00:00:00Z', login_count: 1, last_login_at: '2026-07-09T00:00:00Z' },
      ],
      authUsers: [{ id: 'u1', email: 'a@x.com' }, { id: 'u2', email: 'b@x.com' }],
      buys: [], deposits: [], payouts: [],
    }
    const out = buildUserActivity(inputs)
    expect(out.map((u) => u.userId)).toEqual(['u2', 'u1']) // u2 more recent
  })
})
