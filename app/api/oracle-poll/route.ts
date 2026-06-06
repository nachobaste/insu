import { NextRequest, NextResponse } from 'next/server'
import { validateCronRequest } from '@/lib/auth/cronAuth'
import { pollContracts } from '@/lib/oracle/poll'

async function handlePoll(req: NextRequest) {
  const authError = validateCronRequest(req)
  if (authError) return authError
  const count = await pollContracts()
  return NextResponse.json({ readings: count })
}

// Vercel Cron sends GET; POST is kept for manual triggering
export const GET = handlePoll
export const POST = handlePoll
