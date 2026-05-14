import { describe, it, expect, vi } from 'vitest'
import { repriceAll, repriceTier } from '@/lib/pricing/reprice'

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
  trigger_type: 'manual',
  trigger_condition: {},
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

// Builds a mock DB client with injectable response data
function makeDb(opts: {
  contracts?: typeof mockContract[]
  tier?: typeof mockTier | null
  contract?: typeof mockContract | null
} = {}) {
  const contracts = opts.contracts ?? [mockContract]
  const tier = opts.tier !== undefined ? opts.tier : mockTier
  const contract = opts.contract !== undefined ? opts.contract : mockContract

  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn().mockReturnValue({ eq: updateEq })
  const insert = vi.fn().mockResolvedValue({ error: null })

  const db = {
    from: vi.fn((table: string) => {
      if (table === 'contracts') {
        // Used in repriceAll: .select().eq() awaited as array
        // Used in repriceTier: .select().eq().single() awaited as single
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
      return {}
    }),
    _update: update,
    _updateEq: updateEq,
    _insert: insert,
  }
  return db as any
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
})
