import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn().mockResolvedValue({ error: null })
const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } })

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser }, rpc })),
}))

import { recordLogin } from '@/lib/actions/auth'

beforeEach(() => {
  rpc.mockClear()
  getUser.mockClear()
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
})

describe('recordLogin', () => {
  it('increments the login counter for the authenticated user', async () => {
    await recordLogin()
    expect(rpc).toHaveBeenCalledWith('increment_login_count', { p_user_id: 'u1' })
  })

  it('is a no-op when unauthenticated', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } })
    await recordLogin()
    expect(rpc).not.toHaveBeenCalled()
  })
})
