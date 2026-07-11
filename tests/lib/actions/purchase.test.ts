import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dailyHazard, priceTenor } from '@/lib/pricing/derivative'

// vi.hoisted ensures these are created before vi.mock factories run (which are hoisted)
const {
  mockGetUser,
  mockTierQuery,
  mockContractQuery,
  mockPositionInsert,
  mockPaymentIntentsCreate,
  mockPaymentIntentsUpdate,
  mockPendingCountQuery,
  mockOracleReadingsQuery,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockTierQuery: vi.fn(),
  mockContractQuery: vi.fn(),
  mockPositionInsert: vi.fn(),
  mockPaymentIntentsCreate: vi.fn(),
  mockPaymentIntentsUpdate: vi.fn(),
  mockPendingCountQuery: vi.fn(),
  mockOracleReadingsQuery: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      if (table === 'coverage_tiers') return mockTierQuery()
      if (table === 'contracts') return mockContractQuery()
      if (table === 'oracle_readings') return mockOracleReadingsQuery()
      if (table === 'hedger_positions') {
        // mockPendingCountQuery handles the count-only guard query;
        // mockPositionInsert handles the insert chain.
        // Return an object that dispatches based on which method is called first.
        const countChain = mockPendingCountQuery()
        const insertChain = mockPositionInsert()
        return {
          select: (...args: unknown[]) => {
            // The pending-count guard calls .select('id', { count: 'exact', head: true })
            // i.e. the second argument is an object with head: true
            if (args[1] && typeof args[1] === 'object' && (args[1] as Record<string, unknown>).head === true) {
              return countChain.select(...args)
            }
            return insertChain.select(...args)
          },
          insert: (...args: unknown[]) => insertChain.insert(...args),
        }
      }
      return {}
    }),
  })),
}))

vi.mock('stripe', () => ({
  default: vi.fn(function MockStripe() {
    return {
      paymentIntents: {
        create: mockPaymentIntentsCreate,
        update: mockPaymentIntentsUpdate,
      },
    }
  }),
}))

vi.mock('@/lib/utils/capacity', () => ({
  validateBuyerCapacity: vi.fn().mockReturnValue(null),
  validateProviderCapacity: vi.fn().mockReturnValue(null),
}))

// Non-recurring (one-time) tier and contract
const mockTier = {
  id: 'tier-basic',
  contract_id: 'c1',
  name: 'basic',
  premium_usd: 12,
  payout_usd: 500,
  premium_mxn: 204,
  payout_mxn: 8500,
  max_capacity_usd: 100000,
  current_capacity_usd: 0,
  max_payouts: 1,
  base_probability: 0.05,
}

const mockContract = {
  id: 'c1',
  trigger_type: 'events',
  is_recurring: false,
  trigger_condition: null,
  trigger_deadline: '2026-12-31T23:59:59Z',
  created_at: '2026-01-01T00:00:00Z',
}

// Recurring (urban) tier and contract
const mockRecurringTier = {
  id: 'tier-recurring',
  contract_id: 'c2',
  name: 'basic',
  premium_usd: 12,
  payout_usd: 500,
  premium_mxn: 204,
  payout_mxn: 8500,
  max_capacity_usd: 100000,
  current_capacity_usd: 0,
  max_payouts: 1,
  base_probability: 0.05,
}

const mockRecurringContract = {
  id: 'c2',
  trigger_type: 'urban',
  is_recurring: true,
  trigger_condition: { metric: 'aqi', threshold: 150, operator: 'gte' },
  trigger_deadline: null,
  created_at: '2026-01-01T00:00:00Z',
}

const mockOracleReading = { value: { aqi: 100 } }

// Serves both oracle_readings queries in the purchase flow:
//  - the trigger-fired gate (select id ... eq(trigger_met) [gte] limit) — no .order
//  - the pricing read (select value ... order(read_at desc) limit)
// Dispatch on whether .order was called before .limit.
function makeOracleChain(reading: unknown | null, firedRows: unknown[] = []) {
  const chain: Record<string, unknown> = {}
  let ordered = false
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.gte = vi.fn().mockReturnValue(chain)
  chain.order = vi.fn(() => {
    ordered = true
    return chain
  })
  chain.limit = vi.fn(() =>
    Promise.resolve(
      ordered
        ? { data: reading ? [reading] : [], error: null }
        : { data: firedRows, error: null },
    ),
  )
  return chain
}

function setupMocks(opts: { recurring?: boolean; firedRows?: unknown[]; reading?: unknown } = {}) {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })

  const tier = opts.recurring ? mockRecurringTier : mockTier
  const contract = opts.recurring ? mockRecurringContract : mockContract

  const tierChain = { select: vi.fn(), eq: vi.fn(), single: vi.fn() }
  tierChain.select.mockReturnValue(tierChain)
  tierChain.eq.mockReturnValue(tierChain)
  tierChain.single.mockResolvedValue({ data: tier, error: null })
  mockTierQuery.mockReturnValue(tierChain)

  const contractChain = { select: vi.fn(), eq: vi.fn(), single: vi.fn() }
  contractChain.select.mockReturnValue(contractChain)
  contractChain.eq.mockReturnValue(contractChain)
  contractChain.single.mockResolvedValue({ data: contract, error: null })
  mockContractQuery.mockReturnValue(contractChain)

  // Oracle readings mock: trigger-fired gate (both paths) + pricing read (recurring)
  mockOracleReadingsQuery.mockReturnValue(
    makeOracleChain(
      opts.reading !== undefined ? opts.reading : (opts.recurring ? mockOracleReading : null),
      opts.firedRows ?? [],
    ),
  )

  const posInsertChain = { insert: vi.fn(), select: vi.fn(), single: vi.fn() }
  posInsertChain.insert.mockReturnValue(posInsertChain)
  posInsertChain.select.mockReturnValue(posInsertChain)
  posInsertChain.single.mockResolvedValue({ data: { id: 'pos-1' }, error: null })
  mockPositionInsert.mockReturnValue(posInsertChain)

  // Default: 0 pending positions (guard does not trigger)
  // The full chain is: .select(...).eq(...).eq(...) and is then awaited.
  // Make the chain thenable so awaiting it resolves to the count result.
  const makeCountChain = (count: number) => {
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn().mockReturnValue(chain)
    chain.eq = vi.fn().mockReturnValue(chain)
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ count, error: null }).then(resolve)
    return chain
  }
  mockPendingCountQuery.mockReturnValue(makeCountChain(0))

  mockPaymentIntentsCreate.mockResolvedValue({ id: 'pi_test', client_secret: 'secret_test' })
  mockPaymentIntentsUpdate.mockResolvedValue({})
}

describe('createHedgerPaymentIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STRIPE_SECRET_KEY = 'sk_test_mock_key'
    setupMocks()
  })

  it('charges full premium when no period given (one-time contract)', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-basic')
    // 12.00 USD = 1200 cents
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1200 }),
    )
  })

  it('charges live engine price for 7-day recurring contract', async () => {
    setupMocks({ recurring: true })
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-recurring', 7)

    // Compute expected premium using the real derivative engine
    const reading = mockOracleReading
    const condition = mockRecurringContract.trigger_condition as Parameters<typeof dailyHazard>[2]
    const p = dailyHazard(Number(mockRecurringTier.base_probability), reading, condition)
    // current_capacity_usd = 0, max_capacity_usd = 100000 → capacityFactor = 1.0
    const { premiumUsd: expectedPremium } = priceTenor(
      mockRecurringTier.payout_usd,
      7,
      p,
      mockRecurringTier.max_payouts,
      { capacityFactor: 1.0 },
    )
    const expectedCents = Math.max(50, Math.round(expectedPremium * 100))

    const call = mockPaymentIntentsCreate.mock.calls[0][0]
    expect(call.amount).toBe(expectedCents)
  })

  it('stores coverage_period_days on the position for recurring contract', async () => {
    setupMocks({ recurring: true })
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-recurring', 7)
    const posChain = mockPositionInsert()
    const insertArg = posChain.insert.mock.calls[0][0]
    expect(insertArg.coverage_period_days).toBe(7)
  })

  it('stores null coverage_period_days when no period given (one-time contract)', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-basic')
    const posChain = mockPositionInsert()
    const insertArg = posChain.insert.mock.calls[0][0]
    expect(insertArg.coverage_period_days).toBeNull()
  })

  it('sets expires_at to trigger_deadline when no period given (one-time contract)', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-basic')
    const posChain = mockPositionInsert()
    const insertArg = posChain.insert.mock.calls[0][0]
    // toISOString() normalises to .000Z; compare as Date to avoid format mismatch
    expect(new Date(insertArg.expires_at).getTime()).toBe(new Date(mockContract.trigger_deadline).getTime())
  })

  it('sets expires_at to ~now + periodDays for recurring contract (not clamped to deadline)', async () => {
    setupMocks({ recurring: true })
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    const before = Date.now()
    await createHedgerPaymentIntent('tier-recurring', 7)
    const after = Date.now()
    const posChain = mockPositionInsert()
    const insertArg = posChain.insert.mock.calls[0][0]
    const expiresMs = new Date(insertArg.expires_at).getTime()
    // Should be approximately now + 7 days (within a few seconds)
    expect(expiresMs).toBeGreaterThanOrEqual(before + 7 * 86_400_000)
    expect(expiresMs).toBeLessThanOrEqual(after + 7 * 86_400_000 + 1000)
  })

  it('inserts reserved_usd = max_payouts * payout_usd for recurring contract', async () => {
    setupMocks({ recurring: true })
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-recurring', 7)
    const posChain = mockPositionInsert()
    const insertArg = posChain.insert.mock.calls[0][0]
    expect(insertArg.reserved_usd).toBe(mockRecurringTier.max_payouts * mockRecurringTier.payout_usd)
  })

  it('inserts payouts_remaining = max_payouts for recurring contract', async () => {
    setupMocks({ recurring: true })
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-recurring', 7)
    const posChain = mockPositionInsert()
    const insertArg = posChain.insert.mock.calls[0][0]
    expect(insertArg.payouts_remaining).toBe(mockRecurringTier.max_payouts)
  })

  it('returns error when no periodDays given for recurring contract', async () => {
    setupMocks({ recurring: true })
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    const result = await createHedgerPaymentIntent('tier-recurring')
    expect(result).toEqual({ error: 'Choose a protection period' })
  })

  it('returns clientSecret on success', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    const result = await createHedgerPaymentIntent('tier-basic', 7)
    expect(result).toEqual({ clientSecret: 'secret_test' })
  })

  it('rejects when user has 5 or more pending_payment positions', async () => {
    // Override the count mock to return 5 pending positions
    // Re-use the same makeCountChain helper via the module-level setupMocks pattern
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn().mockReturnValue(chain)
    chain.eq = vi.fn().mockReturnValue(chain)
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ count: 5, error: null }).then(resolve)
    mockPendingCountQuery.mockReturnValue(chain)

    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    const result = await createHedgerPaymentIntent('tier-basic')
    expect(result).toEqual({
      error: 'You have too many pending purchases. Complete or cancel them before buying again.',
    })
    // Stripe and position insert should not have been called
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled()
    expect(mockPositionInsert().insert).not.toHaveBeenCalled()
  })

  describe('trigger-fired purchase gate', () => {
    it('rejects recurring purchase when the trigger already fired today', async () => {
      setupMocks({ recurring: true, firedRows: [{ id: 'r-fired' }] })
      const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
      const result = await createHedgerPaymentIntent('tier-recurring', 7)
      expect(result).toHaveProperty('error')
      expect((result as { error: string }).error).toMatch(/triggered/i)
      expect(mockPaymentIntentsCreate).not.toHaveBeenCalled()
    })

    it('scopes the recurring gate to the current market-local day, not the UTC day', async () => {
      // 01:00 UTC on the 8th is 19:00 on the 7th in market time (UTC-6):
      // the gate must look back to the local day start (06:00Z), or an
      // evening trigger before UTC midnight would reopen purchases at 00:00Z.
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-08T01:00:00.000Z'))
      try {
        setupMocks({ recurring: true })
        const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
        await createHedgerPaymentIntent('tier-recurring', 7)
        const chain = mockOracleReadingsQuery.mock.results[0]?.value
        expect(chain.gte).toHaveBeenCalledWith('read_at', '2026-07-07T06:00:00Z')
      } finally {
        vi.useRealTimers()
      }
    })

    it('rejects recurring purchase when the latest reading shows the trigger active', async () => {
      // Cross-UTC-midnight case: no trigger_met reading yet "today", but the
      // most recent reading (late yesterday UTC) still has the trigger active.
      setupMocks({ recurring: true, reading: { value: { aqi: 200 }, trigger_met: true } })
      const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
      const result = await createHedgerPaymentIntent('tier-recurring', 7)
      expect(result).toHaveProperty('error')
      expect((result as { error: string }).error).toMatch(/active/i)
      expect(mockPaymentIntentsCreate).not.toHaveBeenCalled()
    })

    it('rejects one-time purchase once the contract has triggered', async () => {
      setupMocks({ firedRows: [{ id: 'r-fired' }] })
      const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
      const result = await createHedgerPaymentIntent('tier-basic')
      expect(result).toHaveProperty('error')
      expect((result as { error: string }).error).toMatch(/triggered/i)
      expect(mockPaymentIntentsCreate).not.toHaveBeenCalled()
    })

    it('allows recurring purchase when the trigger has not fired today and is not active', async () => {
      setupMocks({ recurring: true })
      const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
      const result = await createHedgerPaymentIntent('tier-recurring', 7)
      expect(result).toHaveProperty('clientSecret')
    })
  })
})
