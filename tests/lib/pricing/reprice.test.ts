import { describe, it, expect, vi, type Mock } from 'vitest'
import { repriceAll, repriceTier } from '@/lib/pricing/reprice'
import { dailyHazard, priceTenor, capacityFactor } from '@/lib/pricing/derivative'

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

// ─── Recurring vs one-time routing ───────────────────────────────────────────

const recurringTier = {
  ...mockTier,
  id: 'tier-r',
  base_probability: 0.05,
  payout_usd: 500,
  max_payouts: 1,
  current_capacity_usd: 0,
  max_capacity_usd: 100000,
}

const recurringContract = {
  ...mockContract,
  id: 'c-r',
  is_recurring: true,
  coverage_tiers: [recurringTier],
  trigger_condition: { metric: 'temp_c', threshold: 25, operator: 'gte' },
}

const fuelRecurringContract = {
  ...recurringContract,
  id: 'c-fuel',
  trigger_type: 'fuel',
  trigger_condition: { metric: 'gas_price_quetzales', threshold: 45, operator: 'gte', region: 'guatemala', fuel_type: 'regular' },
  coverage_tiers: [{ ...recurringTier, id: 'tier-fuel', base_probability: 0.0043 }],
}

function makeFuelRecurringDb() {
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn().mockReturnValue({ eq: updateEq })
  const insert = vi.fn().mockResolvedValue({ error: null })
  const db = {
    from: vi.fn((table: string) => {
      if (table === 'contracts') {
        const single = vi.fn().mockResolvedValue({ data: fuelRecurringContract, error: null })
        const eq = vi.fn().mockReturnValue(
          Object.assign(Promise.resolve({ data: [fuelRecurringContract], error: null }), { single }),
        )
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      if (table === 'coverage_tiers') {
        const single = vi.fn().mockResolvedValue({ data: fuelRecurringContract.coverage_tiers[0], error: null })
        const eq = vi.fn().mockReturnValue({ single })
        return { select: vi.fn().mockReturnValue({ eq }), update }
      }
      if (table === 'pricing_history') return { insert }
      if (table === 'oracle_readings') {
        const limit = vi.fn().mockResolvedValue({ data: [], error: null })
        const order = vi.fn().mockReturnValue({ limit })
        const eq = vi.fn().mockReturnValue({ order })
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      return {}
    }),
    _update: update, _updateEq: updateEq, _insert: insert,
  }
  return db as MockDb
}

describe('fuel recurring: sticker uses the 7-day min tenor', () => {
  it('prices the sticker at tenorDays=7 (not 1)', async () => {
    const db = makeFuelRecurringDb()
    await repriceTier('tier-fuel', db)
    const pricingInputs = db._update.mock.calls[0][0].pricing_inputs
    expect(pricingInputs.tenorDays).toBe(7)

    const p = dailyHazard(0.0043, null, fuelRecurringContract.trigger_condition as never)
    const cap = capacityFactor(0, 100000)
    const expected = priceTenor(fuelRecurringContract.coverage_tiers[0].payout_usd, 7, p, 1, { capacityFactor: cap }).premiumUsd
    expect(db._update.mock.calls[0][0].premium_usd).toBeCloseTo(expected, 5)
  })
})

const oneTimeContract = {
  ...mockContract,
  id: 'c-ot',
  is_recurring: false,
  coverage_tiers: [mockTier],
}

function makeRecurringDb(opts: {
  reading?: { value: Record<string, unknown> } | null
} = {}) {
  const reading = opts.reading !== undefined ? opts.reading : null
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn().mockReturnValue({ eq: updateEq })
  const insert = vi.fn().mockResolvedValue({ error: null })

  const db = {
    from: vi.fn((table: string) => {
      if (table === 'contracts') {
        const single = vi.fn().mockResolvedValue({ data: recurringContract, error: null })
        const eq = vi.fn().mockReturnValue(
          Object.assign(Promise.resolve({ data: [recurringContract], error: null }), { single }),
        )
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      if (table === 'coverage_tiers') {
        const single = vi.fn().mockResolvedValue({ data: recurringTier, error: null })
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

function makeOneTimeDb() {
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn().mockReturnValue({ eq: updateEq })
  const insert = vi.fn().mockResolvedValue({ error: null })

  const db = {
    from: vi.fn((table: string) => {
      if (table === 'contracts') {
        const single = vi.fn().mockResolvedValue({ data: oneTimeContract, error: null })
        const eq = vi.fn().mockReturnValue(
          Object.assign(Promise.resolve({ data: [oneTimeContract], error: null }), { single }),
        )
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      if (table === 'coverage_tiers') {
        const single = vi.fn().mockResolvedValue({ data: mockTier, error: null })
        const eq = vi.fn().mockReturnValue({ single })
        return { select: vi.fn().mockReturnValue({ eq }), update }
      }
      if (table === 'pricing_history') {
        return { insert }
      }
      if (table === 'oracle_readings') {
        const limit = vi.fn().mockResolvedValue({ data: [], error: null })
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

describe('recurring sticker = 1-day engine quote', () => {
  it('recurring contract: sticker equals priceTenor(1-day) with no oracle reading', async () => {
    const db = makeRecurringDb()  // no reading → multiplier 1.0
    await repriceTier('tier-r', db)

    const condition = recurringContract.trigger_condition as never
    const p = dailyHazard(recurringTier.base_probability, null, condition)
    const cap = capacityFactor(recurringTier.current_capacity_usd, recurringTier.max_capacity_usd)
    const expected = priceTenor(recurringTier.payout_usd, 1, p, recurringTier.max_payouts, { capacityFactor: cap }).premiumUsd

    const actualPremium = db._update.mock.calls[0][0].premium_usd
    expect(actualPremium).toBeCloseTo(expected, 5)
    expect(actualPremium).toBeGreaterThan(0)
  })

  it('recurring contract: sticker uses the derivative engine, not legacy priceTier formula', async () => {
    const db = makeRecurringDb()
    await repriceTier('tier-r', db)

    // The derivative 1-day engine formula for maxPayouts=1, tenorDays=1:
    // P(N>=1 | T=1, p) = p, so premium = payout * p * loading * cap
    // With p=dailyHazard(0.05, null, cond) = clamp(0.05,0.0005,0.95) = 0.05
    // cap = capacityFactor(0, 100000) = 1.0 (empty pool)
    // premium = 500 * 0.05 * 1.15 * 1.0 = 28.75
    const expected = Math.round(500 * 0.05 * 1.15 * 1.0 * 100) / 100  // 28.75
    const actualPremium = db._update.mock.calls[0][0].premium_usd
    expect(actualPremium).toBeCloseTo(expected, 2)
  })

  it('recurring contract: pricing_inputs has derivative engine keys (tenorDays, p, expectedPayouts)', async () => {
    // This distinguishes the derivative engine from the legacy priceTier engine.
    // Legacy stores: { utilization, daysRemaining, utilizationFactor, timeFactor, loadingFactor, oracleMultiplier }
    // Derivative stores: { p, tenorDays, maxPayouts, loading, capacityFactor, expectedPayouts, oracleMultiplier }
    const db = makeRecurringDb()
    await repriceTier('tier-r', db)
    const pricingInputs = db._update.mock.calls[0][0].pricing_inputs
    expect(pricingInputs).toHaveProperty('tenorDays', 1)
    expect(pricingInputs).toHaveProperty('maxPayouts', 1)
    expect(pricingInputs).toHaveProperty('expectedPayouts')
    expect(pricingInputs).not.toHaveProperty('daysRemaining')
    expect(pricingInputs).not.toHaveProperty('timeFactor')
  })

  it('recurring contract: oracleMultiplier is stored in pricing_inputs', async () => {
    const db = makeRecurringDb()
    await repriceTier('tier-r', db)
    const pricingInputs = db._update.mock.calls[0][0].pricing_inputs
    expect(pricingInputs).toHaveProperty('oracleMultiplier')
    expect(pricingInputs.oracleMultiplier).toBe(1)
  })

  it('recurring contract: off-window reading does not discount premium below base sticker', async () => {
    // temp_c=1 vs threshold 25 → raw proximity 0.04 (old floor clamped it to 0.3);
    // recurring pricing must ignore the sub-1.0 discount entirely.
    const offWindow = makeRecurringDb({ reading: { value: { temp_c: 1 } } })
    const noReading = makeRecurringDb()
    await repriceTier('tier-r', offWindow)
    await repriceTier('tier-r', noReading)

    const discounted = offWindow._update.mock.calls[0][0].premium_usd
    const base = noReading._update.mock.calls[0][0].premium_usd
    expect(discounted).toBeCloseTo(base, 5)

    const pricingInputs = offWindow._update.mock.calls[0][0].pricing_inputs
    expect(pricingInputs.oracleMultiplier).toBe(1)
  })

  it('recurring contract: near-trigger reading still raises premium (upside kept)', async () => {
    // temp_c=50 vs threshold 25 → multiplier 2.0 → premium doubles vs no reading.
    const hot = makeRecurringDb({ reading: { value: { temp_c: 50 } } })
    const noReading = makeRecurringDb()
    await repriceTier('tier-r', hot)
    await repriceTier('tier-r', noReading)

    const raised = hot._update.mock.calls[0][0].premium_usd
    const base = noReading._update.mock.calls[0][0].premium_usd
    expect(raised).toBeCloseTo(base * 2, 5)
    expect(hot._update.mock.calls[0][0].pricing_inputs.oracleMultiplier).toBeCloseTo(2.0, 5)
  })

  it('recurring contract: repriceAll also uses derivative engine (pricing_inputs has tenorDays)', async () => {
    const db = makeRecurringDb()
    const count = await repriceAll(db)
    expect(count).toBe(1)

    const condition = recurringContract.trigger_condition as never
    const p = dailyHazard(recurringTier.base_probability, null, condition)
    const cap = capacityFactor(recurringTier.current_capacity_usd, recurringTier.max_capacity_usd)
    const expected = priceTenor(recurringTier.payout_usd, 1, p, recurringTier.max_payouts, { capacityFactor: cap }).premiumUsd

    const actualPremium = db._update.mock.calls[0][0].premium_usd
    expect(actualPremium).toBeCloseTo(expected, 5)

    const pricingInputs = db._update.mock.calls[0][0].pricing_inputs
    expect(pricingInputs).toHaveProperty('tenorDays', 1)
  })
})

describe('one-time contract: legacy priceTier path unchanged', () => {
  it('one-time contract: update is called with a positive premium', async () => {
    const db = makeOneTimeDb()
    await repriceTier('tier-1', db)
    expect(db._update).toHaveBeenCalledTimes(1)
    const actualPremium = db._update.mock.calls[0][0].premium_usd
    expect(actualPremium).toBeGreaterThan(0)
  })

  it('one-time contract: pricing_inputs has legacy engine keys (daysRemaining, timeFactor)', async () => {
    // Legacy priceTier stores different fields than the derivative engine.
    const db = makeOneTimeDb()
    await repriceTier('tier-1', db)
    const pricingInputs = db._update.mock.calls[0][0].pricing_inputs
    expect(pricingInputs).toHaveProperty('daysRemaining')
    expect(pricingInputs).toHaveProperty('timeFactor')
    expect(pricingInputs).not.toHaveProperty('tenorDays')
  })

  it('one-time contract: pricing_history insert is called once', async () => {
    const db = makeOneTimeDb()
    await repriceTier('tier-1', db)
    expect(db._insert).toHaveBeenCalledTimes(1)
    const insertArg = db._insert.mock.calls[0][0]
    expect(insertArg.premium_usd_after).toBeGreaterThan(0)
  })
})
