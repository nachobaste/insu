import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { repriceAll } from '@/lib/pricing/reprice'

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(req.headers.get('authorization') ?? '')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const count = await repriceAll()
  return NextResponse.json({ repriced: count })
}
