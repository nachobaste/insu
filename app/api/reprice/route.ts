import { NextRequest, NextResponse } from 'next/server'
import { repriceAll } from '@/lib/pricing/reprice'

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const count = await repriceAll()
  return NextResponse.json({ repriced: count })
}
