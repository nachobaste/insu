import { describe, it, expect, vi } from 'vitest'
import { createNotification } from '@/lib/notifications/create'

function makeDb(opts: { prefs?: Record<string, boolean> | null } = {}) {
  const insert = vi.fn().mockResolvedValue({ error: null })
  const profileSingle = vi.fn().mockResolvedValue({
    data: { notification_prefs: opts.prefs ?? { coverage_paid: true, coverage_expired: true, protection_purchased: true, provider_settled: true } },
    error: null,
  })
  const db = {
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: profileSingle }) }) }
      }
      if (table === 'notifications') {
        return { insert }
      }
      throw new Error(`unexpected table ${table}`)
    }),
  }
  return { db, insert }
}

describe('createNotification', () => {
  it('inserts a notification when the pref for the type is on', async () => {
    const { db, insert } = makeDb()
    await createNotification(db, {
      userId: 'u1', type: 'coverage_paid', title: 'Paid', body: 'You were paid', contractId: 'c1',
    })
    expect(insert).toHaveBeenCalledWith({
      user_id: 'u1', type: 'coverage_paid', title: 'Paid', body: 'You were paid', contract_id: 'c1',
    })
  })

  it('no-ops when the pref for the type is off', async () => {
    const { db, insert } = makeDb({ prefs: { coverage_paid: false } as never })
    await createNotification(db, {
      userId: 'u1', type: 'coverage_paid', title: 'Paid', body: 'b',
    })
    expect(insert).not.toHaveBeenCalled()
  })

  it('defaults contract_id to null when omitted', async () => {
    const { db, insert } = makeDb()
    await createNotification(db, { userId: 'u1', type: 'protection_purchased', title: 't', body: 'b' })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ contract_id: null }),
    )
  })

  it('never throws when the db call fails (best-effort)', async () => {
    const db = { from: vi.fn(() => { throw new Error('db down') }) }
    await expect(
      createNotification(db, { userId: 'u1', type: 'coverage_paid', title: 't', body: 'b' }),
    ).resolves.toBeUndefined()
  })
})
