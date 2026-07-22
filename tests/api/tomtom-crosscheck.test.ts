import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/oracle/crosscheck', () => ({
  runTomTomCrossCheck: vi.fn().mockResolvedValue(5),
}))

async function makeRequest(secret: string) {
  vi.resetModules()
  const { POST } = await import('@/app/api/tomtom-crosscheck/route')
  return POST(new NextRequest('http://localhost/api/tomtom-crosscheck', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  }))
}

describe('POST /api/tomtom-crosscheck', () => {
  beforeEach(() => { process.env.CRON_SECRET = 'test-secret' })

  it('returns 401 with wrong secret', async () => {
    const res = await makeRequest('wrong')
    expect(res.status).toBe(401)
  })

  it('returns captured count with correct secret', async () => {
    const res = await makeRequest('test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ captured: 5 })
  })
})
