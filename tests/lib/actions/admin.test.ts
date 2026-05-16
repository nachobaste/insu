// tests/lib/actions/admin.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('stripe', () => ({ default: vi.fn() }))

import { upsertContract, overrideContractTrigger, retryPayout } from '@/lib/actions/admin'
import { createClient } from '@/lib/supabase/server'
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
    vi.mocked(createClient).mockReturnValue(makeSupabase({
      tables: {
        contracts: { data: { id: 'contract-new' }, error: null },
        coverage_tiers: { data: null, error: null },
      },
    }) as never)

    const id = await upsertContract(baseInput)
    expect(id).toBe('contract-new')
  })

  it('updates contract and tiers on edit, returns existing id', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase({
      tables: {
        contracts: { data: null, error: null },
        coverage_tiers: { data: [{ id: 'tier-basic', name: 'basic' }, { id: 'tier-prem', name: 'premium' }], error: null },
      },
    }) as never)

    const id = await upsertContract({ ...baseInput, id: 'contract-existing' })
    expect(id).toBe('contract-existing')
  })

  it('throws if deadline is in the past', async () => {
    const past = new Date(Date.now() - 86400000).toISOString()
    await expect(upsertContract({ ...baseInput, trigger_deadline: past }))
      .rejects.toThrow('Deadline must be in the future')
  })

  it('throws if basic payout does not exceed basic premium', async () => {
    const bad = { ...baseInput, basic_tier: { premium_usd: 500, payout_usd: 100, max_capacity_usd: 50000 } }
    await expect(upsertContract(bad)).rejects.toThrow('Payout must exceed premium')
  })

  it('throws if calling user is not admin', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase({ role: 'hedger' }) as never)
    await expect(upsertContract(baseInput)).rejects.toThrow('Forbidden')
  })
})
