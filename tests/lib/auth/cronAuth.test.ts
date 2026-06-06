import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { validateCronRequest } from '@/lib/auth/cronAuth'

describe('validateCronRequest', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
  })

  it('returns null when authorization header matches secret', () => {
    const req = new NextRequest('http://localhost/api/test', {
      headers: { authorization: 'Bearer test-secret' },
    })
    expect(validateCronRequest(req)).toBeNull()
  })

  it('returns 401 response when authorization header is wrong', async () => {
    const req = new NextRequest('http://localhost/api/test', {
      headers: { authorization: 'Bearer wrong' },
    })
    const res = validateCronRequest(req)
    expect(res?.status).toBe(401)
    expect(await res?.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 401 when authorization header is missing', async () => {
    const req = new NextRequest('http://localhost/api/test')
    const res = validateCronRequest(req)
    expect(res?.status).toBe(401)
  })

  it('returns 500 when CRON_SECRET env var is not set', async () => {
    delete process.env.CRON_SECRET
    const req = new NextRequest('http://localhost/api/test', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const res = validateCronRequest(req)
    expect(res?.status).toBe(500)
    expect(await res?.json()).toEqual({ error: 'Server misconfiguration' })
  })
})
