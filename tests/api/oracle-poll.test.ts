import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/oracle/poll', () => ({
  pollContracts: vi.fn().mockResolvedValue(3),
  POLLABLE_TRIGGER_TYPES: ['weather', 'urban', 'fuel'],
}))

async function makeRequest(secret: string, query = '') {
  vi.resetModules()
  const { POST } = await import('@/app/api/oracle-poll/route')
  return POST(new NextRequest(`http://localhost/api/oracle-poll${query}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  }))
}

describe('POST /api/oracle-poll', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
  })

  it('returns 401 with wrong secret', async () => {
    const res = await makeRequest('wrong')
    expect(res.status).toBe(401)
  })

  it('returns readings count with correct secret', async () => {
    const res = await makeRequest('test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ readings: 3 })
  })

  it('forwards ?types= to pollContracts as a trigger-type filter', async () => {
    const res = await makeRequest('test-secret', '?types=urban')
    expect(res.status).toBe(200)
    const { pollContracts } = await import('@/lib/oracle/poll')
    expect(pollContracts).toHaveBeenCalledWith(undefined, undefined, ['urban'])
  })

  it('passes no filter (undefined) when ?types= is absent', async () => {
    await makeRequest('test-secret')
    const { pollContracts } = await import('@/lib/oracle/poll')
    expect(pollContracts).toHaveBeenCalledWith(undefined, undefined, undefined)
  })
})
