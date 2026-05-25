import { describe, it, expect, vi, type Mock } from 'vitest'
import { repriceAll, repriceTier } from '@/lib/pricing/reprice'

interface MockDb {
  from: Mock
  _update: Mock
  _updateEq: Mock
  _insert: Mock
}

const futureDeadline = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()

const mockTier = {
  id: 'tier-1',
  contract_id: 'c1',
  name: 'basic',
  premium_usd: 50,
  payout_usd: 500,
  premium_mxn: 850,
  payout_mxn: 8500,
  max_capacity_usd: 100000,
  current_capacity_usd: 0,
  base_probability: 0.10,
  last_priced_at: null,
  pricing_inputs: null,
}

const mockContract = {
  id: 'c1',
  slug: 'test',
  title: 'Test',
  description: null,
  category_id: 'cat-1',
  status: 'active',
  trigger_type: 'weather',
  trigger_condition: { metric: 'temp_c', threshold: 25, operator: 'gte' },
  trigger_deadline: futureDeadline,
  location: { lat: 0, lng: 0, city: 'Test', country: 'MX' },
  icon_url: null,
  total_volume_usd: 0,
  total_volume_mxn: 0,
  is_featured: false,
  settled_outcome: null,
  created_by: 'admin',
  created_at: new Date().toISOString(),
  settled_at: null,
  coverage_tiers: [mockTier],
}

// reading with temp_c = 50, threshold = 25 → proximity = 2.0 → multiplier = 2.0
const mockReading = { value: { temp_c: 50 } }

function makeDb(opts: {
  contracts?: typeof mockContract[]
  tier?: typeof mockTier | null
  contract?: typeof mockContract | null
  reading?: { value: Record<string, unknown> } | null
} = {}) {
  const contracts = opts.contracts ?? [mockContract]
  const tier = opts.tier !== undefined ? opts.tier : mockTier
  const contract = opts.contract !== undefined ? opts.contract : mockContract
  const reading = opts.reading !== undefined ? opts.reading : null

  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn().mockReturnValue({ eq: updateEq })
  const insert = vi.fn().mockResolvedValue({ error: null })

  const db = {
    from: vi.fn((table: string) => {
      if (table === 'contracts') {
        const single = vi.fn().mockResolvedValue({ data: contract, error: null })
        const eq = vi.fn().mockReturnValue(
          Object.assign(Promise.resolve({ data: contracts, error: null }), { single }),
        )
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      if (table === 'coverage_tiers') {
        const single = vi.fn().mockResolvedValue({ data: tier, error: null })
        const eq = vi.fn().mockReturnValue({ single })
        return { select: vi.fn().mockReturnValue({ eq }), update }
      }
      if (table === 'pricing_history') {
        return { insert }
      }
      if (table === 'oracle_readings') {
        const limit = vi.fn().mockResolvedValue({
          data: reading ? [{ value: reading.value }] : [],
          error: null,
        })
        const order = vi.fn().mockReturnValue({ limit })
        const eq = vi.fn().mockReturnValue({ order })
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      return {}
    }),
    _update: update,
    _updateEq: updateEq,
    _insert: insert,
  }
  return db as MockDb
}

describe('repriceAll', () => {
  it('updates coverage_tiers for each active tier', async () => {
    const db = makeDb()
    await repriceAll(db)
    expect(db._update).toHaveBeenCalledTimes(1)
    expect(db._updateEq).toHaveBeenCalledWith('id', 'tier-1')
  })

  it('inserts a pricing_history row for each tier', async () => {
    const db = makeDb()
    await repriceAll(db)
    expect(db._insert).toHaveBeenCalledTimes(1)
    const insertArg = db._insert.mock.calls[0][0]
    expect(insertArg).toMatchObject({
      contract_id: 'c1',
      tier_id: 'tier-1',
      premium_usd_before: 50,
    })
    expect(insertArg.premium_usd_after).toBeGreaterThan(0)
  })

  it('reprices multiple tiers and returns count', async () => {
    const twoTiers = { ...mockContract, coverage_tiers: [mockTier, { ...mockTier, id: 'tier-2' }] }
    const db = makeDb({ contracts: [twoTiers] })
    const count = await repriceAll(db)
    expect(count).toBe(2)
    expect(db._update).toHaveBeenCalledTimes(2)
    expect(db._insert).toHaveBeenCalledTimes(2)
  })

  it('returns 0 and makes no writes when no contracts found', async () => {
    const db = makeDb({ contracts: [] })
    const count = await repriceAll(db)
    expect(count).toBe(0)
    expect(db._update).not.toHaveBeenCalled()
    expect(db._insert).not.toHaveBeenCalled()
  })

  it('applies oracle multiplier — premium doubles at 2× proximity', async () => {
    const dbWith = makeDb({ reading: mockReading })    // multiplier = 2.0
    const dbWithout = makeDb()                          // multiplier = 1.0 (no reading)
    await repriceAll(dbWith)
    await repriceAll(dbWithout)
    const premiumWith = dbWith._update.mock.calls[0][0].premium_usd
    const premiumWithout = dbWithout._update.mock.calls[0][0].premium_usd
    expect(premiumWith).toBeCloseTo(premiumWithout * 2, 1)
  })

  it('stores oracleMultiplier in pricing_inputs when reading is present', async () => {
    const db = makeDb({ reading: mockReading })  // multiplier = 2.0
    await repriceAll(db)
    const pricingInputs = db._update.mock.calls[0][0].pricing_inputs
    expect(pricingInputs.oracleMultiplier).toBeCloseTo(2.0, 5)
  })

  it('stores oracleMultiplier=1 in pricing_inputs when no reading exists', async () => {
    const db = makeDb()  // no reading
    await repriceAll(db)
    const pricingInputs = db._update.mock.calls[0][0].pricing_inputs
    expect(pricingInputs.oracleMultiplier).toBe(1)
  })
})

describe('repriceTier', () => {
  it('updates only the specified tier', async () => {
    const db = makeDb()
    await repriceTier('tier-1', db)
    expect(db._update).toHaveBeenCalledTimes(1)
    expect(db._updateEq).toHaveBeenCalledWith('id', 'tier-1')
  })

  it('inserts one pricing_history row', async () => {
    const db = makeDb()
    await repriceTier('tier-1', db)
    expect(db._insert).toHaveBeenCalledTimes(1)
  })

  it('skips writes when tier not found', async () => {
    const db = makeDb({ tier: null })
    await repriceTier('nonexistent', db)
    expect(db._update).not.toHaveBeenCalled()
    expect(db._insert).not.toHaveBeenCalled()
  })

  it('skips writes when contract is settled', async () => {
    const db = makeDb({ contract: { ...mockContract, status: 'settled' } })
    await repriceTier('tier-1', db)
    expect(db._update).not.toHaveBeenCalled()
    expect(db._insert).not.toHaveBeenCalled()
  })

  it('applies oracle multiplier via repriceTier — premium doubles at 2× proximity', async () => {
    const dbWith = makeDb({ reading: mockReading })    // multiplier = 2.0
    const dbWithout = makeDb()                          // multiplier = 1.0
    await repriceTier('tier-1', dbWith)
    await repriceTier('tier-1', dbWithout)
    const premiumWith = dbWith._update.mock.calls[0][0].premium_usd
    const premiumWithout = dbWithout._update.mock.calls[0][0].premium_usd
    expect(premiumWith).toBeCloseTo(premiumWithout * 2, 1)
  })

  it('stores oracleMultiplier in pricing_inputs via repriceTier', async () => {
    const db = makeDb({ reading: mockReading })  // multiplier = 2.0
    await repriceTier('tier-1', db)
    const pricingInputs = db._update.mock.calls[0][0].pricing_inputs
    expect(pricingInputs.oracleMultiplier).toBeCloseTo(2.0, 5)
  })

  it('stores oracleMultiplier=1 in pricing_inputs via repriceTier when no reading exists', async () => {
    const db = makeDb()  // no reading → multiplier = 1.0
    await repriceTier('tier-1', db)
    const pricingInputs = db._update.mock.calls[0][0].pricing_inputs
    expect(pricingInputs.oracleMultiplier).toBe(1)
  })
})
