import { describe, it, expect, vi } from 'vitest'
import { processPayouts, expireContracts } from '@/lib/payout/processor'
import type { Contract, HedgerPosition, ProviderPosition } from '@/lib/types'

const mockContract: Contract = {
  id: 'c1',
  slug: 'rain-cdmx',
  title: 'Rain CDMX',
  description: null,
  category_id: 'cat-1',
  status: 'active',
  trigger_type: 'weather',
  trigger_condition: {},
  trigger_deadline: new Date(Date.now() + 86400000).toISOString(),
  is_recurring: false,
  location: { lat: 19.4, lng: -99.1, city: 'CDMX', country: 'MX' },
  icon_url: null,
  total_volume_usd: 0,
  total_volume_mxn: 0,
  is_featured: false,
  settled_outcome: null,
  created_by: 'admin',
  created_at: new Date().toISOString(),
  settled_at: null,
}

const mockHedgerPosition: HedgerPosition = {
  id: 'pos-1',
  user_id: 'user-1',
  contract_id: 'c1',
  tier_id: 'tier-1',
  premium_paid_usd: 50,
  payout_amount_usd: 500,
  premium_paid_mxn: 850,
  payout_amount_mxn: 8500,
  currency: 'USD',
  payment_provider: 'stripe',
  payment_intent_id: 'pi_test',
  status: 'active',
  purchased_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86400000).toISOString(),
}

// Position whose coverage expired an hour ago
const expiredPosition: HedgerPosition = {
  ...mockHedgerPosition,
  id: 'pos-expired',
  coverage_period_days: 7,
  expires_at: new Date(Date.now() - 3600_000).toISOString(), // 1 hour ago
}

// Position whose coverage is still active
const activePosition: HedgerPosition = {
  ...mockHedgerPosition,
  id: 'pos-active',
  coverage_period_days: 7,
  expires_at: new Date(Date.now() + 86_400_000).toISOString(), // 1 day from now
}

const expiredOneTimeContract: Contract = {
  ...mockContract,
  id: 'c-onetime',
  slug: 'bad-bunny',
  trigger_type: 'event',
  is_recurring: false,
  trigger_deadline: new Date(Date.now() - 86_400_000).toISOString(),
  settled_outcome: null,
}

const mockProviderPosition: ProviderPosition = {
  id: 'pp-1',
  user_id: 'provider-1',
  contract_id: 'c1',
  tier_id: 'tier-1',
  capital_deposited_usd: 10000,
  capital_deposited_mxn: 0,
  currency: 'USD',
  payment_provider: 'stripe',
  payment_intent_id: 'pi_prov',
  expected_return_usd: 500,
  actual_return_usd: null,
  expected_return_mxn: 0,
  actual_return_mxn: null,
  status: 'active',
  deposited_at: new Date().toISOString(),
  settled_at: null,
}

function makeChainable(value: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is']) {
    b[m] = vi.fn().mockReturnValue(b)
  }
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(value).then(res)
  b.single = vi.fn().mockResolvedValue(value)
  return b
}

function makeDb(opts: {
  triggeredReadings?: Array<{ contract_id: string; read_at?: string }>
  contracts?: Contract[]
  hedgerPositions?: HedgerPosition[]
  providerPositions?: ProviderPosition[]
  profileStripeId?: string | null
} = {}) {
  const triggeredReadings = opts.triggeredReadings ?? [{ contract_id: 'c1', read_at: new Date().toISOString() }]
  const contracts = opts.contracts ?? [mockContract]
  const hedgerPositions = opts.hedgerPositions ?? [mockHedgerPosition]
  const providerPositions = opts.providerPositions ?? [mockProviderPosition]
  const profileStripeId = opts.profileStripeId !== undefined ? opts.profileStripeId : 'cus_test123'

  const contractUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const hedgerUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const providerUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const providerUpdate = vi.fn().mockReturnValue({ eq: providerUpdateEq })
  const profileUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const payoutsUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const payoutsUpdate = vi.fn().mockReturnValue({ eq: payoutsUpdateEq })

  const payoutsInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'payout-1' }, error: null }),
    }),
  })

  const notificationsInsert = vi.fn().mockResolvedValue({ error: null })

  const db = {
    from: vi.fn((table: string) => {
      if (table === 'oracle_readings') {
        return makeChainable({ data: triggeredReadings, error: null })
      }
      if (table === 'contracts') {
        return {
          ...makeChainable({ data: contracts, error: null }),
          update: vi.fn().mockReturnValue({ eq: contractUpdateEq }),
        }
      }
      if (table === 'hedger_positions') {
        return {
          ...makeChainable({ data: hedgerPositions, error: null }),
          update: vi.fn().mockReturnValue({ eq: hedgerUpdateEq }),
        }
      }
      if (table === 'provider_positions') {
        return {
          ...makeChainable({ data: providerPositions, error: null }),
          update: providerUpdate,
        }
      }
      if (table === 'profiles') {
        return {
          ...makeChainable({ data: { stripe_customer_id: profileStripeId, notification_prefs: null }, error: null }),
          update: vi.fn().mockReturnValue({ eq: profileUpdateEq }),
        }
      }
      if (table === 'notifications') {
        return { insert: notificationsInsert }
      }
      if (table === 'payouts') {
        return {
          insert: payoutsInsert,
          update: payoutsUpdate,
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'coverage_tiers') {
        return makeChainable({ data: { payout_usd: 500, payout_mxn: 8500 }, error: null })
      }
      return {}
    }),
    _contractUpdateEq: contractUpdateEq,
    _hedgerUpdateEq: hedgerUpdateEq,
    _providerUpdate: providerUpdate,
    _providerUpdateEq: providerUpdateEq,
    _profileUpdateEq: profileUpdateEq,
    _payoutsInsert: payoutsInsert,
    _payoutsUpdate: payoutsUpdate,
    _payoutsUpdateEq: payoutsUpdateEq,
    _notificationsInsert: notificationsInsert,
  }

  return db
}

function makeStripe(opts: { newCustomerId?: string } = {}) {
  return {
    customers: {
      create: vi.fn().mockResolvedValue({ id: opts.newCustomerId ?? 'cus_new' }),
      createBalanceTransaction: vi.fn().mockResolvedValue({ id: 'txn_123' }),
    },
  }
}

describe('processPayouts', () => {
  it('returns 0 when no triggered readings exist', async () => {
    const db = makeDb({ triggeredReadings: [] })
    const stripe = makeStripe()
    const count = await processPayouts(db as never, stripe as never)
    expect(count).toBe(0)
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled()
  })

  it('returns 0 when all triggered contracts are already settled', async () => {
    const db = makeDb({ contracts: [] }) // no unsettled contracts
    const stripe = makeStripe()
    const count = await processPayouts(db as never, stripe as never)
    expect(count).toBe(0)
  })

  it('marks the contract settled', async () => {
    const db = makeDb()
    await processPayouts(db as never, makeStripe() as never)
    expect(db._contractUpdateEq).toHaveBeenCalledWith('id', 'c1')
  })

  it('does not settle a triggered contract that has no active hedger positions', async () => {
    // No buyers → nothing to pay out → the contract must stay live, not settle.
    const db = makeDb({ hedgerPositions: [] })
    const stripe = makeStripe()
    const count = await processPayouts(db as never, stripe as never)
    expect(count).toBe(0)
    expect(db._contractUpdateEq).not.toHaveBeenCalled()
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled()
  })

  it('credits Stripe Customer Balance with negative cents', async () => {
    const db = makeDb()
    const stripe = makeStripe()
    await processPayouts(db as never, stripe as never)
    // payout_amount_usd = 500 → -50000 cents
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
      'cus_test123',
      { amount: -50000, currency: 'usd' },
    )
  })

  it('marks hedger position as paid_out', async () => {
    const db = makeDb()
    await processPayouts(db as never, makeStripe() as never)
    expect(db._hedgerUpdateEq).toHaveBeenCalledWith('id', 'pos-1')
  })

  it('creates payouts row with processing status then updates to completed', async () => {
    const db = makeDb()
    await processPayouts(db as never, makeStripe() as never)
    const insertArg = db._payoutsInsert.mock.calls[0][0]
    expect(insertArg.status).toBe('processing')
    expect(insertArg.amount_usd).toBe(500)
    expect(db._payoutsUpdateEq).toHaveBeenCalledWith('id', 'payout-1')
  })

  it('creates a Stripe customer when profile has no stripe_customer_id', async () => {
    const db = makeDb({ profileStripeId: null })
    const stripe = makeStripe({ newCustomerId: 'cus_brand_new' })
    await processPayouts(db as never, stripe as never)
    expect(stripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { user_id: 'user-1' } }),
    )
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
      'cus_brand_new',
      expect.objectContaining({ amount: -50000 }),
    )
    expect(db._profileUpdateEq).toHaveBeenCalledWith('id', 'user-1')
  })

  it('settles provider positions with correct loss share', async () => {
    const db = makeDb()
    await processPayouts(db as never, makeStripe() as never)
    // totalHedgerPayout=500, totalProviderCapital=10000
    // lossShare=(10000/10000)*500=500, actualReturn=10000-500=9500
    expect(db._providerUpdateEq).toHaveBeenCalledWith('id', 'pp-1')
    expect(db._providerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ actual_return_usd: 9500, status: 'settled' }),
    )
  })

  it('returns the number of hedger positions paid out', async () => {
    const twoPositions = [
      mockHedgerPosition,
      { ...mockHedgerPosition, id: 'pos-2' },
    ]
    const db = makeDb({ hedgerPositions: twoPositions as HedgerPosition[] })
    const count = await processPayouts(db as never, makeStripe() as never)
    expect(count).toBe(2)
  })

  it('skips position whose coverage_period expired before trigger fired', async () => {
    const db = makeDb({
      triggeredReadings: [{ contract_id: 'c1', read_at: new Date().toISOString() }],
      hedgerPositions: [expiredPosition],
    })
    const stripe = makeStripe()
    const count = await processPayouts(db as never, stripe as never)
    expect(count).toBe(0)
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled()
  })

  it('pays position whose coverage is still active when trigger fires', async () => {
    const db = makeDb({
      triggeredReadings: [{ contract_id: 'c1', read_at: new Date().toISOString() }],
      hedgerPositions: [activePosition],
    })
    const stripe = makeStripe()
    const count = await processPayouts(db as never, stripe as never)
    expect(count).toBe(1)
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalled()
  })

  it('does not pay a one-time position purchased after the trigger fired', async () => {
    const lateBuyer: HedgerPosition = {
      ...mockHedgerPosition,
      id: 'pos-late',
      purchased_at: new Date().toISOString(),
    }
    const db = makeDb({
      triggeredReadings: [{ contract_id: 'c1', read_at: new Date(Date.now() - 3600_000).toISOString() }],
      hedgerPositions: [lateBuyer],
    })
    const stripe = makeStripe()
    const count = await processPayouts(db as never, stripe as never)
    expect(count).toBe(0)
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled()
  })

  it('always pays position with null coverage_period_days (full-duration)', async () => {
    const fullDurationPosition: HedgerPosition = {
      ...mockHedgerPosition,
      id: 'pos-full',
      coverage_period_days: undefined,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }
    const db = makeDb({
      triggeredReadings: [{ contract_id: 'c1', read_at: new Date().toISOString() }],
      hedgerPositions: [fullDurationPosition],
    })
    const count = await processPayouts(db as never, makeStripe() as never)
    expect(count).toBe(1)
  })

  it('marks payout as failed when Stripe balance transaction throws', async () => {
    const db = makeDb()
    const failingStripe = {
      customers: {
        create: vi.fn().mockResolvedValue({ id: 'cus_test123' }),
        createBalanceTransaction: vi.fn().mockRejectedValue(new Error('Stripe network error')),
      },
    }
    const count = await processPayouts(db as never, failingStripe as never)
    expect(count).toBe(0)
    expect(db._payoutsUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('does not create a second payout record when a non-failed payout already exists for the position', async () => {
    const db = makeDb()
    const originalFrom = db.from.bind(db)
    db.from = vi.fn((table: string) => {
      if (table === 'payouts') {
        return {
          insert: db._payoutsInsert,
          update: db._payoutsUpdate,
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'payout-existing', status: 'processing' }, error: null }),
              }),
            }),
          }),
        }
      }
      return originalFrom(table)
    }) as never

    await processPayouts(db as never, makeStripe() as never)
    expect(db._payoutsInsert).not.toHaveBeenCalled()
  })

  it('marks contract settled after processing payouts (not before)', async () => {
    const callOrder: string[] = []
    const db = makeDb()
    const originalFrom = db.from.bind(db)
    db.from = vi.fn((table: string) => {
      const branch = originalFrom(table)
      if (table === 'contracts') {
        const originalUpdate = branch.update.bind(branch)
        branch.update = vi.fn((...args: unknown[]) => {
          callOrder.push('contracts.update')
          return originalUpdate(...args)
        })
      }
      if (table === 'payouts') {
        return {
          insert: vi.fn((...args: unknown[]) => {
            callOrder.push('payouts.insert')
            return db._payoutsInsert(...args)
          }),
          update: db._payoutsUpdate,
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }
      }
      return branch
    }) as never

    await processPayouts(db as never, makeStripe() as never)
    const payoutsInsertIdx = callOrder.indexOf('payouts.insert')
    const contractsUpdateIdx = callOrder.indexOf('contracts.update')
    expect(payoutsInsertIdx).toBeGreaterThanOrEqual(0)
    expect(contractsUpdateIdx).toBeGreaterThan(payoutsInsertIdx)
  })

  it('emits a coverage_paid notification when a hedger position pays out', async () => {
    const db = makeDb()
    await processPayouts(db as never, makeStripe() as never)
    expect(db._notificationsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'coverage_paid' }),
    )
  })

  it('emits a provider_settled notification when a provider position is settled', async () => {
    const db = makeDb()
    await processPayouts(db as never, makeStripe() as never)
    expect(db._notificationsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'provider_settled' }),
    )
  })
})

function makeExpireDb(opts: {
  expiredContracts?: Contract[]
  providerPositions?: ProviderPosition[]
  activeHedgerPositions?: Array<{ id: string; user_id: string }>
} = {}) {
  const expiredContracts = opts.expiredContracts ?? [expiredOneTimeContract]
  const providerPositions = opts.providerPositions ?? []
  const activeHedgerPositions = opts.activeHedgerPositions ?? []

  const contractUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const providerUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const providerUpdate = vi.fn().mockReturnValue({ eq: providerUpdateEq })
  const notificationsInsert = vi.fn().mockResolvedValue({ error: null })

  // A fully chainable stub for tables we don't assert on
  function chainable(resolved: unknown) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'update', 'eq', 'in', 'is', 'lt']) {
      b[m] = vi.fn().mockReturnValue(b)
    }
    Object.assign(b, {
      then: (res: (v: unknown) => unknown) => Promise.resolve(resolved).then(res),
      single: vi.fn().mockResolvedValue(resolved),
    })
    return b
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'contracts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  lt: vi.fn().mockResolvedValue({ data: expiredContracts, error: null }),
                }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({ eq: contractUpdateEq }),
        }
      }
      if (table === 'hedger_positions') {
        return {
          // select('id, user_id').eq('contract_id', ...).eq('status', 'active') → active positions
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: activeHedgerPositions, error: null }),
            }),
          }),
          // bulk update to 'expired': update().eq().eq()  AND  update().eq().lt()
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
              lt: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }
      }
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { notification_prefs: null }, error: null }),
            }),
          }),
        }
      }
      if (table === 'notifications') {
        return { insert: notificationsInsert }
      }
      if (table === 'provider_positions') {
        return {
          ...chainable({ data: providerPositions, error: null }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: providerPositions, error: null }),
            }),
          }),
          update: providerUpdate,
        }
      }
      return chainable({ data: [], error: null })
    }),
    _contractUpdateEq: contractUpdateEq,
    _providerUpdate: providerUpdate,
    _providerUpdateEq: providerUpdateEq,
    _notificationsInsert: notificationsInsert,
  }
}

// ---------------------------------------------------------------------------
// Recurring settlement helpers
// ---------------------------------------------------------------------------

/**
 * Build a db mock tuned for recurring-settlement tests.
 *
 * Key differences from makeDb:
 *  - contracts has is_recurring:true
 *  - hedger_positions returns the supplied recurring positions
 *  - payouts idempotency chain is eq().eq().neq().maybeSingle() (position_id + trigger_day)
 *  - contractUpdateCalls[] accumulates every `.update(data)` arg on contracts so
 *    we can assert the contract was NEVER settled
 */
function makeRecurringDb(opts: {
  triggeredReadings: Array<{ contract_id: string; read_at: string }>
  recurringContract: Contract
  recurringPositions: HedgerPosition[]
  existingPayout?: { id: string } | null
}) {
  const { triggeredReadings, recurringContract, recurringPositions, existingPayout = null } = opts

  const contractUpdateCalls: unknown[] = []
  const contractUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const contractUpdate = vi.fn((data: unknown) => {
    contractUpdateCalls.push(data)
    return { eq: contractUpdateEq }
  })

  const hedgerUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const hedgerUpdate = vi.fn().mockReturnValue({ eq: hedgerUpdateEq })

  const payoutsUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const payoutsUpdate = vi.fn().mockReturnValue({ eq: payoutsUpdateEq })

  const payoutsInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'payout-r1' }, error: null }),
    }),
  })

  // payouts idempotency: select().eq(hedger_position_id).eq(trigger_day).neq().maybeSingle()
  const payoutsMaybeSingle = vi.fn().mockResolvedValue({ data: existingPayout, error: null })
  const payoutsNeq = vi.fn().mockReturnValue({ maybeSingle: payoutsMaybeSingle })
  const payoutsEq2 = vi.fn().mockReturnValue({ neq: payoutsNeq })
  const payoutsEq1 = vi.fn().mockReturnValue({ eq: payoutsEq2 })
  const payoutsSelect = vi.fn().mockReturnValue({ eq: payoutsEq1 })

  // hedger_positions: chainable select for recurring
  function makeHedgerChainable() {
    // Need to support: .select('*').eq('contract_id', ...).eq('status', 'active') → data
    const resolved = { data: recurringPositions, error: null }
    const eqInner = vi.fn().mockResolvedValue(resolved)
    const eqOuter = vi.fn().mockReturnValue({ eq: eqInner })
    return {
      select: vi.fn().mockReturnValue({ eq: eqOuter }),
      update: hedgerUpdate,
    }
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'oracle_readings') {
        return makeChainable({ data: triggeredReadings, error: null })
      }
      if (table === 'contracts') {
        // select chain: .select('*').in(...).eq(...).is(...) → { data: [recurringContract] }
        return {
          ...makeChainable({ data: [recurringContract], error: null }),
          update: contractUpdate,
        }
      }
      if (table === 'hedger_positions') {
        return makeHedgerChainable()
      }
      if (table === 'coverage_tiers') {
        return makeChainable({ data: { payout_usd: 500, payout_mxn: 8500 }, error: null })
      }
      if (table === 'profiles') {
        return {
          ...makeChainable({ data: { stripe_customer_id: 'cus_recur' }, error: null }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        }
      }
      if (table === 'payouts') {
        return {
          insert: payoutsInsert,
          update: payoutsUpdate,
          select: payoutsSelect,
        }
      }
      return {}
    }),
    _contractUpdateCalls: contractUpdateCalls,
    _contractUpdateEq: contractUpdateEq,
    _hedgerUpdate: hedgerUpdate,
    _hedgerUpdateEq: hedgerUpdateEq,
    _payoutsInsert: payoutsInsert,
    _payoutsUpdate: payoutsUpdate,
  }
}

describe('recurring settlement', () => {
  // A recurring contract that stays live forever
  const recurringContract: Contract = {
    ...mockContract,
    id: 'rc-1',
    slug: 'rain-cdmx-recurring',
    is_recurring: true,
    settled_outcome: null,
    status: 'active',
  }

  // Dates used across tests — all in the past week so window math is easy
  const day1 = '2026-06-15'
  const day2 = '2026-06-16'
  const day3 = '2026-06-17'
  const day4 = '2026-06-18'

  // Position whose window brackets day1..day4
  const windowStart = '2026-06-14T00:00:00.000Z' // day before day1
  const windowEnd   = '2026-06-19T23:59:59.000Z' // day after day4

  function makeReading(day: string): { contract_id: string; read_at: string } {
    return { contract_id: 'rc-1', read_at: `${day}T12:00:00.000Z` }
  }

  function makeRecurringPosition(overrides: Partial<HedgerPosition> = {}): HedgerPosition {
    return {
      ...mockHedgerPosition,
      id: 'rpos-1',
      contract_id: 'rc-1',
      purchased_at: windowStart,
      expires_at: windowEnd,
      payouts_remaining: 1,
      payouts_made: 0,
      last_payout_date: null,
      ...overrides,
    }
  }

  it('basic position (payouts_remaining 1) pays once; position becomes knocked_out; contracts never settled', async () => {
    const position = makeRecurringPosition({ payouts_remaining: 1 })
    const db = makeRecurringDb({
      triggeredReadings: [makeReading(day1)],
      recurringContract,
      recurringPositions: [position],
    })
    const stripe = makeStripe()

    const count = await processPayouts(db as never, stripe as never)

    // Exactly one payout issued
    expect(count).toBe(1)
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1)

    // hedger_positions updated to knocked_out with payouts_remaining: 0
    expect(db._hedgerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'knocked_out', payouts_remaining: 0 }),
    )
    expect(db._hedgerUpdateEq).toHaveBeenCalledWith('id', 'rpos-1')

    // contracts table must NEVER receive a settled_outcome or status:'settled' update
    const settledCall = db._contractUpdateCalls.find(
      (c) => (c as Record<string, unknown>).settled_outcome !== undefined ||
              (c as Record<string, unknown>).status === 'settled',
    )
    expect(settledCall).toBeUndefined()
  })

  it('pro position (payouts_remaining 3) + 4 distinct in-window trigger-days → exactly 3 payouts; knocked_out', async () => {
    const position = makeRecurringPosition({ id: 'rpos-pro', payouts_remaining: 3 })
    const db = makeRecurringDb({
      triggeredReadings: [makeReading(day1), makeReading(day2), makeReading(day3), makeReading(day4)],
      recurringContract,
      recurringPositions: [position],
    })
    const stripe = makeStripe()

    const count = await processPayouts(db as never, stripe as never)

    expect(count).toBe(3)
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(3)

    expect(db._hedgerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'knocked_out', payouts_remaining: 0 }),
    )
  })

  it('same calendar day appearing twice in readings → only ONE payout', async () => {
    const position = makeRecurringPosition({ payouts_remaining: 3 })
    // Two readings on the same day — should collapse to one trigger-day
    const db = makeRecurringDb({
      triggeredReadings: [
        { contract_id: 'rc-1', read_at: `${day1}T08:00:00.000Z` },
        { contract_id: 'rc-1', read_at: `${day1}T20:00:00.000Z` },
      ],
      recurringContract,
      recurringPositions: [position],
    })
    const stripe = makeStripe()

    const count = await processPayouts(db as never, stripe as never)

    expect(count).toBe(1)
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1)
  })

  it('does NOT pay for a same-day trigger that fired before the position was purchased', async () => {
    // Trigger fired at 08:00; position bought at 10:00 the same day. The buyer
    // never covered that event and must not collect for it.
    const position = makeRecurringPosition({ purchased_at: `${day1}T10:00:00.000Z` })
    const db = makeRecurringDb({
      triggeredReadings: [{ contract_id: 'rc-1', read_at: `${day1}T08:00:00.000Z` }],
      recurringContract,
      recurringPositions: [position],
    })
    const stripe = makeStripe()

    const count = await processPayouts(db as never, stripe as never)

    expect(count).toBe(0)
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled()
  })

  it('pays for a same-day trigger that fired after the position was purchased', async () => {
    const position = makeRecurringPosition({ purchased_at: `${day1}T08:00:00.000Z` })
    const db = makeRecurringDb({
      triggeredReadings: [{ contract_id: 'rc-1', read_at: `${day1}T12:00:00.000Z` }],
      recurringContract,
      recurringPositions: [position],
    })
    const stripe = makeStripe()

    const count = await processPayouts(db as never, stripe as never)

    expect(count).toBe(1)
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1)
  })

  it('a pre-purchase same-day trigger does not block payouts for later trigger-days', async () => {
    const position = makeRecurringPosition({
      purchased_at: `${day1}T10:00:00.000Z`,
      payouts_remaining: 3,
    })
    const db = makeRecurringDb({
      triggeredReadings: [
        { contract_id: 'rc-1', read_at: `${day1}T08:00:00.000Z` }, // before purchase → not covered
        { contract_id: 'rc-1', read_at: `${day2}T12:00:00.000Z` }, // next day → covered
      ],
      recurringContract,
      recurringPositions: [position],
    })
    const stripe = makeStripe()

    const count = await processPayouts(db as never, stripe as never)

    expect(count).toBe(1)
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1)
  })

  it('an evening window straddling UTC midnight pays only ONCE (one local trigger-day)', async () => {
    // GT/CDMX evening rush 5–8pm local = 23:00–02:00 UTC: readings before and
    // after UTC midnight are the SAME jam. Bucketing by UTC date paid twice.
    const position = makeRecurringPosition({ id: 'rpos-evening', payouts_remaining: 3 })
    const db = makeRecurringDb({
      triggeredReadings: [
        { contract_id: 'rc-1', read_at: `${day1}T23:30:00.000Z` }, // 17:30 local, day1
        { contract_id: 'rc-1', read_at: `${day2}T00:15:00.000Z` }, // 18:15 local, still day1
      ],
      recurringContract,
      recurringPositions: [position],
    })
    const stripe = makeStripe()

    const count = await processPayouts(db as never, stripe as never)

    expect(count).toBe(1)
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1)
  })

  it('triggers on two distinct local days still pay twice', async () => {
    const position = makeRecurringPosition({ id: 'rpos-twodays', payouts_remaining: 3 })
    const db = makeRecurringDb({
      triggeredReadings: [
        { contract_id: 'rc-1', read_at: `${day1}T23:30:00.000Z` }, // 17:30 local, day1
        { contract_id: 'rc-1', read_at: `${day2}T23:30:00.000Z` }, // 17:30 local, day2
      ],
      recurringContract,
      recurringPositions: [position],
    })
    const stripe = makeStripe()

    const count = await processPayouts(db as never, stripe as never)

    expect(count).toBe(2)
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(2)
  })

  it('trigger-day outside the position window → no payout', async () => {
    // Position window: day1..day2; trigger is day4 (after windowEnd)
    const narrowWindowEnd = '2026-06-16T23:59:59.000Z' // ends on day2
    const position = makeRecurringPosition({
      purchased_at: windowStart,
      expires_at: narrowWindowEnd,
      payouts_remaining: 3,
    })
    const db = makeRecurringDb({
      triggeredReadings: [makeReading(day4)], // day4 = 2026-06-18, outside window
      recurringContract,
      recurringPositions: [position],
    })
    const stripe = makeStripe()

    const count = await processPayouts(db as never, stripe as never)

    expect(count).toBe(0)
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled()
  })
})

describe('expireContracts', () => {
  it('returns 0 when no one-time contracts have passed deadline', async () => {
    const db = makeExpireDb({ expiredContracts: [] })
    const count = await expireContracts(db as never)
    expect(count).toBe(0)
  })

  it('returns 1 when one expired one-time contract is found', async () => {
    const db = makeExpireDb()
    const count = await expireContracts(db as never)
    expect(count).toBe(1)
  })

  it('settles expired one-time contract with settled_outcome=false', async () => {
    const db = makeExpireDb()
    await expireContracts(db as never)
    expect(db._contractUpdateEq).toHaveBeenCalledWith('id', 'c-onetime')
  })

  it('settles provider positions with full capital return when contract expires without trigger', async () => {
    const providerPos: ProviderPosition = {
      ...mockProviderPosition,
      id: 'pp-event',
      contract_id: 'c-onetime',
      capital_deposited_usd: 5000,
    }
    const db = makeExpireDb({ providerPositions: [providerPos] })
    await expireContracts(db as never)
    expect(db._providerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'settled', actual_return_usd: 5000 }),
    )
    expect(db._providerUpdateEq).toHaveBeenCalledWith('id', 'pp-event')
  })

  it('emits a coverage_expired notification for each active hedger position on an expired one-time contract', async () => {
    const db = makeExpireDb({
      activeHedgerPositions: [{ id: 'hp-1', user_id: 'user-1' }],
    })
    await expireContracts(db as never)
    expect(db._notificationsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'coverage_expired' }),
    )
  })
})
