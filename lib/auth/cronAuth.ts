import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export function validateCronRequest(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(req.headers.get('authorization') ?? '')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
