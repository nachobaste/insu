import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { submitProgram, type SubmitProgramInput } from '@/lib/actions/submit'
import { createClient } from '@/lib/supabase/server'

const validInput: SubmitProgramInput = {
  title: 'Cancún Hurricane Cover',
  description: 'Pays out when a hurricane makes landfall.',
  category_id: 'cat-1',
  trigger_type: 'weather',
  trigger_description: 'Hurricane landfall within 50km',
  location_city: 'Cancún',
  location_country: 'Mexico',
  event_date: '2026-12-31',
  proposed_payout: '500',
}

function makeSupabase(opts: { insertError?: Error; userId?: string | null } = {}) {
  const insert = vi.fn().mockResolvedValue({ error: opts.insertError ?? null })
  return {
    _insert: insert,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.userId === null ? null : { id: opts.userId ?? 'user-1' } },
      }),
    },
    from: vi.fn((table: string) => (table === 'contracts' ? { insert } : {})),
  }
}

describe('submitProgram', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts a pending contract and returns an id without reading the row back', async () => {
    const sb = makeSupabase()
    vi.mocked(createClient).mockResolvedValue(sb as never)

    const result = await submitProgram(validInput)

    expect(sb._insert).toHaveBeenCalledTimes(1)
    const payload = sb._insert.mock.calls[0][0]
    expect(payload).toMatchObject({
      status: 'pending',
      created_by: 'user-1',
      trigger_type: 'weather',
    })
    // The action must supply its own id (it cannot SELECT the pending row back
    // through the public RLS policy, which only exposes active/settled rows).
    expect(typeof payload.id).toBe('string')
    expect(payload.id.length).toBeGreaterThan(0)
    expect(result.id).toBe(payload.id)
  })

  it('throws when the user is not signed in', async () => {
    const sb = makeSupabase({ userId: null })
    vi.mocked(createClient).mockResolvedValue(sb as never)
    await expect(submitProgram(validInput)).rejects.toThrow('signed in')
  })

  it('surfaces a database insert error', async () => {
    const sb = makeSupabase({ insertError: new Error('boom') })
    vi.mocked(createClient).mockResolvedValue(sb as never)
    await expect(submitProgram(validInput)).rejects.toThrow('Failed to submit program')
  })
})
