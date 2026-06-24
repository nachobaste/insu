import { NextRequest, NextResponse } from 'next/server'
import { validateCronRequest } from '@/lib/auth/cronAuth'
import { pollContracts, ensureCorridorPolylines, POLLABLE_TRIGGER_TYPES } from '@/lib/oracle/poll'

/**
 * Optional `?types=urban,weather` scopes the poll to specific trigger types so
 * separate crons can run on different cadences (e.g. corridors every 15 min
 * during commute windows, weather once a day). Unknown values are ignored; an
 * absent/empty param polls all supported types.
 */
function parseTypes(req: NextRequest): string[] | undefined {
  const raw = req.nextUrl.searchParams.get('types')
  if (!raw) return undefined
  const types = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => (POLLABLE_TRIGGER_TYPES as readonly string[]).includes(t))
  return types.length > 0 ? types : undefined
}

async function handlePoll(req: NextRequest) {
  const authError = validateCronRequest(req)
  if (authError) return authError
  // `?backfill=polylines` fills missing corridor road geometry (one-off / on demand),
  // independent of the commute-window-gated traffic poll.
  if (req.nextUrl.searchParams.get('backfill') === 'polylines') {
    const filled = await ensureCorridorPolylines()
    return NextResponse.json({ polylines_filled: filled })
  }
  const count = await pollContracts(undefined, undefined, parseTypes(req))
  return NextResponse.json({ readings: count })
}

// Vercel Cron sends GET; POST is kept for manual triggering
export const GET = handlePoll
export const POST = handlePoll
