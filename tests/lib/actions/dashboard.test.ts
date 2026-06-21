import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { getDashboardData } from '@/lib/actions/dashboard'
import { createClient } from '@/lib/supabase/server'

function makeChainable(value: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order']) {
    b[m] = vi.fn().mockReturnValue(b)
  }
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(value).then(res)
  return b
}

function makeSupabase(opts: {
  hedgerData?: unknown[]
  hedgerError?: Error
  providerData?: unknown[]
  providerError?: Error
  payoutsData?: unknown[]
  payoutsError?: Error
} = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === 'hedger_positions')
        return makeChainable({ data: opts.hedgerData ?? [], error: opts.hedgerError ?? null })
      if (table === 'provider_positions')
        return makeChainable({ data: opts.providerData ?? [], error: opts.providerError ?? null })
      if (table === 'payouts')
        return makeChainable({ data: opts.payoutsData ?? [], error: opts.payoutsError ?? null })
      return makeChainable({ data: [], error: null })
    }),
  }
}

describe('getDashboardData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns all three arrays when queries succeed', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase({
      hedgerData: [{ id: 'hp-1', status: 'active' }],
      providerData: [{ id: 'pp-1', status: 'active' }],
      payoutsData: [{ id: 'pay-1', status: 'completed' }],
    }) as never)

    const result = await getDashboardData('user-1')
    expect(result.hedgerPositions).toHaveLength(1)
    expect(result.hedgerPositions[0]).toMatchObject({ id: 'hp-1', status: 'active' })
    expect(result.providerPositions).toHaveLength(1)
    expect(result.providerPositions[0]).toMatchObject({ id: 'pp-1', status: 'active' })
    expect(result.payouts).toHaveLength(1)
    expect(result.payouts[0]).toMatchObject({ id: 'pay-1', status: 'completed' })
  })

  it('hides positions and payouts whose contract is cancelled', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase({
      hedgerData: [
        { id: 'hp-1', status: 'active', contract: { id: 'c-1', status: 'active' } },
        { id: 'hp-2', status: 'active', contract: { id: 'c-2', status: 'cancelled' } },
      ],
      providerData: [
        { id: 'pp-1', status: 'active', contract: { id: 'c-2', status: 'cancelled' } },
      ],
      payoutsData: [
        { id: 'pay-1', status: 'completed', contract: { id: 'c-1', status: 'active' } },
        { id: 'pay-2', status: 'completed', contract: { id: 'c-2', status: 'cancelled' } },
      ],
    }) as never)

    const result = await getDashboardData('user-1')
    expect(result.hedgerPositions.map((p) => p.id)).toEqual(['hp-1'])
    expect(result.providerPositions).toEqual([])
    expect(result.payouts.map((p) => p.id)).toEqual(['pay-1'])
  })

  it('returns empty arrays when user has no data', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase() as never)

    const result = await getDashboardData('user-1')
    expect(result.hedgerPositions).toEqual([])
    expect(result.providerPositions).toEqual([])
    expect(result.payouts).toEqual([])
  })

  it('throws when hedger positions query fails', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase({
      hedgerError: new Error('DB error'),
    }) as never)

    await expect(getDashboardData('user-1')).rejects.toThrow('DB error')
  })

  it('throws when provider positions query fails', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase({
      providerError: new Error('DB error'),
    }) as never)

    await expect(getDashboardData('user-1')).rejects.toThrow('DB error')
  })

  it('throws when payouts query fails', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase({
      payoutsError: new Error('DB error'),
    }) as never)

    await expect(getDashboardData('user-1')).rejects.toThrow('DB error')
  })
})
