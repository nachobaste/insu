import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted ensures these are created before vi.mock factories run (which are hoisted)
const {
  mockGetUser,
  mockTierQuery,
  mockContractQuery,
  mockPositionInsert,
  mockPaymentIntentsCreate,
  mockPaymentIntentsUpdate,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockTierQuery: vi.fn(),
  mockContractQuery: vi.fn(),
  mockPositionInsert: vi.fn(),
  mockPaymentIntentsCreate: vi.fn(),
  mockPaymentIntentsUpdate: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      if (table === 'coverage_tiers') return mockTierQuery()
      if (table === 'contracts') return mockContractQuery()
      if (table === 'hedger_positions') return mockPositionInsert()
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
  validateCapacity: vi.fn().mockReturnValue(null),
}))

// Contract: 365-day duration (Jan 1 → Dec 31 2026)
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
}

const mockContract = {
  id: 'c1',
  trigger_deadline: '2026-12-31T23:59:59Z',
  created_at: '2026-01-01T00:00:00Z',
}

function setupMocks() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })

  const tierChain = { select: vi.fn(), eq: vi.fn(), single: vi.fn() }
  tierChain.select.mockReturnValue(tierChain)
  tierChain.eq.mockReturnValue(tierChain)
  tierChain.single.mockResolvedValue({ data: mockTier, error: null })
  mockTierQuery.mockReturnValue(tierChain)

  const contractChain = { select: vi.fn(), eq: vi.fn(), single: vi.fn() }
  contractChain.select.mockReturnValue(contractChain)
  contractChain.eq.mockReturnValue(contractChain)
  contractChain.single.mockResolvedValue({ data: mockContract, error: null })
  mockContractQuery.mockReturnValue(contractChain)

  const posInsertChain = { insert: vi.fn(), select: vi.fn(), single: vi.fn() }
  posInsertChain.insert.mockReturnValue(posInsertChain)
  posInsertChain.select.mockReturnValue(posInsertChain)
  posInsertChain.single.mockResolvedValue({ data: { id: 'pos-1' }, error: null })
  mockPositionInsert.mockReturnValue(posInsertChain)

  mockPaymentIntentsCreate.mockResolvedValue({ id: 'pi_test', client_secret: 'secret_test' })
  mockPaymentIntentsUpdate.mockResolvedValue({})
}

describe('createHedgerPaymentIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('charges full premium when no period given', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-basic')
    // 12.00 USD = 1200 cents
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1200 }),
    )
  })

  it('charges period-scaled premium for 7-day period, floored at 50 cents', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    // Contract is 365 days; periodFactor = 7/365 ≈ 0.01918; 12 * 0.01918 ≈ 0.23; cents = 23
    // Stripe minimum is $0.50 (50 cents), so amount is clamped to 50
    await createHedgerPaymentIntent('tier-basic', 7)
    const call = mockPaymentIntentsCreate.mock.calls[0][0]
    expect(call.amount).toBe(50)
  })

  it('stores coverage_period_days on the position', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-basic', 7)
    const posChain = mockPositionInsert()
    const insertArg = posChain.insert.mock.calls[0][0]
    expect(insertArg.coverage_period_days).toBe(7)
  })

  it('stores null coverage_period_days when no period given', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-basic')
    const posChain = mockPositionInsert()
    const insertArg = posChain.insert.mock.calls[0][0]
    expect(insertArg.coverage_period_days).toBeNull()
  })

  it('sets expires_at to trigger_deadline when no period given', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-basic')
    const posChain = mockPositionInsert()
    const insertArg = posChain.insert.mock.calls[0][0]
    // toISOString() normalises to .000Z; compare as Date to avoid format mismatch
    expect(new Date(insertArg.expires_at).getTime()).toBe(new Date(mockContract.trigger_deadline).getTime())
  })

  it('sets expires_at before trigger_deadline for 7-day period', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-basic', 7)
    const posChain = mockPositionInsert()
    const insertArg = posChain.insert.mock.calls[0][0]
    // expires_at should be ~7 days from now, which is well before Dec 31 2026
    expect(new Date(insertArg.expires_at) < new Date(mockContract.trigger_deadline)).toBe(true)
  })

  it('returns clientSecret on success', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    const result = await createHedgerPaymentIntent('tier-basic', 7)
    expect(result).toEqual({ clientSecret: 'secret_test' })
  })
})
