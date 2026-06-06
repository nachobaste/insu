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

  return {
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
          ...makeChainable({ data: { stripe_customer_id: profileStripeId }, error: null }),
          update: vi.fn().mockReturnValue({ eq: profileUpdateEq }),
        }
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
  }
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
})

function makeExpireDb(opts: {
  expiredContracts?: Contract[]
  providerPositions?: ProviderPosition[]
} = {}) {
  const expiredContracts = opts.expiredContracts ?? [expiredOneTimeContract]
  const providerPositions = opts.providerPositions ?? []

  const contractUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const providerUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const providerUpdate = vi.fn().mockReturnValue({ eq: providerUpdateEq })

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
        return chainable({ data: [], error: null })
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
  }
}

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
})
