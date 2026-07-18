import { describe, it, expect, vi, beforeEach } from 'vitest'

const updateEq = vi.fn().mockResolvedValue({ error: null })
const update = vi.fn().mockReturnValue({ eq: updateEq })
const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } })

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
    from: vi.fn(() => ({ update })),
  })),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { updateProfile } from '@/lib/actions/profile'

beforeEach(() => {
  update.mockClear()
  updateEq.mockClear()
})

describe('updateProfile', () => {
  it('writes valid fields', async () => {
    const res = await updateProfile({
      full_name: 'Ada',
      preferred_currency: 'USD',
      notification_prefs: { coverage_paid: true, coverage_expired: false, protection_purchased: true, provider_settled: true, product_launched: true },
    })
    expect(res).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      full_name: 'Ada',
      preferred_currency: 'USD',
    }))
  })

  it('rejects an invalid currency', async () => {
    const res = await updateProfile({ preferred_currency: 'EUR' as never })
    expect(res).toEqual({ error: 'Invalid currency' })
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects malformed notification_prefs', async () => {
    const res = await updateProfile({ notification_prefs: { coverage_paid: 'yes' } as never })
    expect(res).toEqual({ error: 'Invalid notification preferences' })
    expect(update).not.toHaveBeenCalled()
  })
})

describe('updateProfile currency validation', () => {
  it('rejects the legacy MXN value', async () => {
    const res = await updateProfile({ preferred_currency: 'MXN' as never })
    expect(res).toEqual({ error: 'Invalid currency' })
  })
  it('rejects an arbitrary currency', async () => {
    const res = await updateProfile({ preferred_currency: 'GTQ' as never })
    expect(res).toEqual({ error: 'Invalid currency' })
  })
})
