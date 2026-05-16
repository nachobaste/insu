// tests/lib/actions/admin.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createServiceClient: vi.fn() }))
vi.mock('stripe', () => {
  const MockStripe = vi.fn(function (this: unknown) { return this })
  return { default: MockStripe }
})

import { upsertContract, overrideContractTrigger, retryPayout } from '@/lib/actions/admin'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

function makeChainable(result: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'update', 'not', 'is']) {
    b[m] = vi.fn().mockReturnValue(b)
  }
  b.insert = vi.fn().mockReturnValue(b)
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
  b.single = vi.fn().mockResolvedValue(result)
  return b
}

function makeSupabase({
  role = 'admin',
  userId = 'admin-1',
  tables = {} as Record<string, unknown>,
  stripeCustId = null as string | null,
} = {}) {
  let profilesCallIdx = 0
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        profilesCallIdx++
        if (profilesCallIdx === 1) {
          return makeChainable({ data: { role }, error: null })
        }
        return makeChainable({ data: { stripe_customer_id: stripeCustId }, error: null })
      }
      return makeChainable(tables[table] ?? { data: null, error: null })
    }),
  }
}

const baseInput = {
  title: 'Rain CDMX',
  description: null,
  category_id: 'cat-1',
  status: 'active' as const,
  trigger_type: 'weather' as const,
  trigger_condition: { metric: 'rainfall', comparator: '>', threshold: 25, unit: 'mm/hr' },
  trigger_deadline: new Date(Date.now() + 86400000 * 30).toISOString(),
  location: { city: 'CDMX', country: 'MX', lat: 19.4, lng: -99.1 },
  icon_url: null,
  is_featured: false,
  basic_tier: { premium_usd: 45, payout_usd: 500, max_capacity_usd: 50000 },
  premium_tier: { premium_usd: 120, payout_usd: 2000, max_capacity_usd: 100000 },
}

describe('upsertContract', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts contract and two tiers on create, returns new id', async () => {
    const mockSb = makeSupabase({
      tables: {
        contracts: { data: { id: 'contract-new' }, error: null },
        coverage_tiers: { data: null, error: null },
      },
    }) as never
    vi.mocked(createClient).mockReturnValue(mockSb)
    vi.mocked(createServiceClient).mockReturnValue(mockSb)

    const id = await upsertContract(baseInput)
    expect(id).toBe('contract-new')
  })

  it('updates contract and tiers on edit, returns existing id', async () => {
    const mockSb = makeSupabase({
      tables: {
        contracts: { data: null, error: null },
        coverage_tiers: { data: [{ id: 'tier-basic', name: 'basic' }, { id: 'tier-prem', name: 'premium' }], error: null },
      },
    }) as never
    vi.mocked(createClient).mockReturnValue(mockSb)
    vi.mocked(createServiceClient).mockReturnValue(mockSb)

    const id = await upsertContract({ ...baseInput, id: 'contract-existing' })
    expect(id).toBe('contract-existing')
  })

  it('throws if deadline is in the past', async () => {
    const mockSb = makeSupabase() as never
    vi.mocked(createClient).mockReturnValue(mockSb)
    vi.mocked(createServiceClient).mockReturnValue(mockSb)
    const past = new Date(Date.now() - 86400000).toISOString()
    await expect(upsertContract({ ...baseInput, trigger_deadline: past }))
      .rejects.toThrow('Deadline must be in the future')
  })

  it('throws if basic payout does not exceed basic premium', async () => {
    const mockSb = makeSupabase() as never
    vi.mocked(createClient).mockReturnValue(mockSb)
    vi.mocked(createServiceClient).mockReturnValue(mockSb)
    const bad = { ...baseInput, basic_tier: { premium_usd: 500, payout_usd: 100, max_capacity_usd: 50000 } }
    await expect(upsertContract(bad)).rejects.toThrow('Payout must exceed premium')
  })

  it('throws if calling user is not admin', async () => {
    const userClientMock = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: vi.fn(),
    }
    const serviceClientMock = makeSupabase({ role: 'hedger' })
    vi.mocked(createClient).mockReturnValue(userClientMock as never)
    vi.mocked(createServiceClient).mockReturnValue(serviceClientMock as never)
    await expect(upsertContract(baseInput)).rejects.toThrow('Forbidden')
  })

  it('throws if premium tier payout does not exceed premium tier premium', async () => {
    const mockSb = makeSupabase() as never
    vi.mocked(createClient).mockReturnValue(mockSb)
    vi.mocked(createServiceClient).mockReturnValue(mockSb)
    const bad = { ...baseInput, premium_tier: { premium_usd: 2000, payout_usd: 500, max_capacity_usd: 100000 } }
    await expect(upsertContract(bad)).rejects.toThrow('Payout must exceed premium')
  })
})

describe('overrideContractTrigger', () => {
  beforeEach(() => vi.clearAllMocks())

  it('settles contract and inserts audit log — no trigger (outcome=false)', async () => {
    const userClientMock = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null }),
      },
      from: vi.fn(),
    }
    const mockSupabase = makeSupabase({
      tables: {
        contracts: { data: null, error: null },
        admin_audit_log: { data: null, error: null },
        hedger_positions: { data: [], error: null },
      },
    })
    vi.mocked(createClient).mockReturnValue(userClientMock as never)
    vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)

    await overrideContractTrigger({ contractId: 'c-1', outcome: false, reason: 'test' })

    const fromCalls = mockSupabase.from.mock.calls.map((c: unknown[]) => c[0])
    expect(fromCalls).toContain('contracts')
    expect(fromCalls).toContain('admin_audit_log')
    // Stripe should NOT be instantiated when outcome = false
    expect(vi.mocked(Stripe)).not.toHaveBeenCalled()
  })

  it('settles contract, issues Stripe credits for each hedger — outcome=true', async () => {
    const userClientMock = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null }),
      },
      from: vi.fn(),
    }
    const mockSupabase = makeSupabase({
      stripeCustId: 'cus_existing',
      tables: {
        contracts: { data: null, error: null },
        admin_audit_log: { data: null, error: null },
        hedger_positions: {
          data: [
            { id: 'hp-1', user_id: 'user-1', payout_amount_usd: 500, payout_amount_mxn: 8500, currency: 'USD', status: 'active' },
          ],
          error: null,
        },
        payouts: { data: { id: 'pay-1' }, error: null },
      },
    })
    vi.mocked(createClient).mockReturnValue(userClientMock as never)
    vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)

    const mockStripeInstance = {
      customers: {
        create: vi.fn().mockResolvedValue({ id: 'cus_new' }),
        createBalanceTransaction: vi.fn().mockResolvedValue({ id: 'txn_1' }),
      },
    }
    vi.mocked(Stripe).mockImplementation(function () { return mockStripeInstance as never })

    await overrideContractTrigger({ contractId: 'c-1', outcome: true, reason: 'oracle outage' })

    expect(mockStripeInstance.customers.createBalanceTransaction).toHaveBeenCalledWith(
      'cus_existing',
      { amount: -50000, currency: 'usd' },
    )
  })

  it('throws Forbidden if caller is not admin', async () => {
    const userClientMock = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: vi.fn(),
    }
    vi.mocked(createClient).mockReturnValue(userClientMock as never)
    vi.mocked(createServiceClient).mockReturnValue(makeSupabase({ role: 'hedger' }) as never)
    await expect(
      overrideContractTrigger({ contractId: 'c-1', outcome: false, reason: 'test' })
    ).rejects.toThrow('Forbidden')
  })
})

describe('retryPayout', () => {
  beforeEach(() => vi.clearAllMocks())

  it('issues Stripe credit and marks payout completed', async () => {
    const userClientMock = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null }),
        from: vi.fn(),
      },
    }
    const mockPayout = {
      id: 'pay-1',
      hedger_position_id: 'hp-1',
      amount_usd: 500,
      currency: 'USD',
      status: 'processing',
      hedger_positions: { user_id: 'user-1', id: 'hp-1' },
    }
    const mockSupabase = makeSupabase({
      stripeCustId: 'cus_abc',
      tables: {
        payouts: { data: mockPayout, error: null },
      },
    })
    vi.mocked(createClient).mockReturnValue(userClientMock as never)
    vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)

    const mockStripeInstance = {
      customers: {
        create: vi.fn().mockResolvedValue({ id: 'cus_new' }),
        createBalanceTransaction: vi.fn().mockResolvedValue({ id: 'txn_retry' }),
      },
    }
    vi.mocked(Stripe).mockImplementation(function () { return mockStripeInstance } as never)

    await retryPayout('pay-1')

    expect(mockStripeInstance.customers.createBalanceTransaction).toHaveBeenCalledWith(
      'cus_abc',
      { amount: -50000, currency: 'usd' },
    )
  })

  it('throws if payout not found', async () => {
    const userClientMock = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null }),
        from: vi.fn(),
      },
    }
    const mockSupabase = makeSupabase({
      tables: {
        payouts: { data: null, error: { message: 'No rows found' } },
      },
    })
    vi.mocked(createClient).mockReturnValue(userClientMock as never)
    vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)

    await expect(retryPayout('nonexistent')).rejects.toThrow('Payout not found')
  })
})
