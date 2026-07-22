import { NextRequest, NextResponse } from 'next/server'
import { validateCronRequest } from '@/lib/auth/cronAuth'
import { runTomTomCrossCheck } from '@/lib/oracle/crosscheck'

// Read-only shadow of the traffic oracle. Writes ONLY to tomtom_crosscheck;
// never touches oracle_readings, triggers, or pricing.
export const maxDuration = 300

async function handle(req: NextRequest) {
  const authError = validateCronRequest(req)
  if (authError) return authError
  const captured = await runTomTomCrossCheck()
  return NextResponse.json({ captured })
}

export const GET = handle
export const POST = handle
