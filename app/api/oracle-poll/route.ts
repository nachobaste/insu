import { NextRequest, NextResponse } from 'next/server'
import { pollContracts } from '@/lib/oracle/poll'

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const count = await pollContracts()
  return NextResponse.json({ readings: count })
}
