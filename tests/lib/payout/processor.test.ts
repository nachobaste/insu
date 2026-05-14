import { describe, it, expect, vi } from 'vitest'
import { processPayouts } from '@/lib/payout/processor'
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
  triggeredReadings?: Array<{ contract_id: string }>
  contracts?: Contract[]
  hedgerPositions?: HedgerPosition[]
  providerPositions?: ProviderPosition[]
  profileStripeId?: string | null
} = {}) {
  const triggeredReadings = opts.triggeredReadings ?? [{ contract_id: 'c1' }]
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
          update: vi.fn().mockReturnValue({ eq: payoutsUpdateEq }),
        }
      }
      return {}
    }),
    _contractUpdateEq: contractUpdateEq,
    _hedgerUpdateEq: hedgerUpdateEq,
    _providerUpdate: providerUpdate,
    _providerUpdateEq: providerUpdateEq,
    _profileUpdateEq: profileUpdateEq,
    _payoutsInsert: payoutsInsert,
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
})
