import { NextRequest, NextResponse } from 'next/server'
import { validateCronRequest } from '@/lib/auth/cronAuth'
import { repriceAll } from '@/lib/pricing/reprice'

async function handleReprice(req: NextRequest) {
  const authError = validateCronRequest(req)
  if (authError) return authError
  const count = await repriceAll()
  return NextResponse.json({ repriced: count })
}

// Vercel Cron sends GET; POST is kept for manual triggering
export const GET = handleReprice
export const POST = handleReprice
