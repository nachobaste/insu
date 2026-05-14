import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/pricing/reprice', () => ({
  repriceAll: vi.fn().mockResolvedValue(4),
}))

async function makeRequest(secret: string) {
  const { POST } = await import('@/app/api/reprice/route')
  return POST(new NextRequest('http://localhost/api/reprice', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  }))
}

describe('POST /api/reprice', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
    vi.resetModules()
  })

  it('returns 401 with wrong secret', async () => {
    const res = await makeRequest('wrong')
    expect(res.status).toBe(401)
  })

  it('returns 200 and repriced count with correct secret', async () => {
    const res = await makeRequest('test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ repriced: 4 })
  })
})
