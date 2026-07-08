import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/payout/processor', () => ({
  processPayouts: vi.fn().mockResolvedValue(2),
  expireContracts: vi.fn().mockResolvedValue(1),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue({}),
}))
vi.mock('stripe', () => {
  class MockStripe {
    constructor(_key: string) {}
  }
  return { default: MockStripe }
})

async function makeRequest(secret: string) {
  vi.resetModules()
  const { POST } = await import('@/app/api/payout-process/route')
  return POST(new NextRequest('http://localhost/api/payout-process', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  }))
}

describe('POST /api/payout-process', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
    process.env.STRIPE_SECRET_KEY = 'sk_test_key'
  })

  it('returns 401 with wrong secret', async () => {
    const res = await makeRequest('wrong')
    expect(res.status).toBe(401)
  })

  it('returns paid and expired counts with correct secret', async () => {
    const res = await makeRequest('test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ paid: 2, expired: 1 })
  })
})
