import { NextRequest, NextResponse } from 'next/server'
import { validateCronRequest } from '@/lib/auth/cronAuth'
import { createServiceClient } from '@/lib/supabase/server'
import { samplePredictedCorridor } from '@/lib/calibration/predictedTraffic'

// ~40 sequential Routes API calls per corridor; well under the 300s limit.
export const maxDuration = 300

/**
 * Returns Google predicted-traffic samples for ONE corridor (?corridor=<slug>).
 * Read-only: never writes to the database — blending and applying happen in
 * scripts/calibrate-corridors.mjs, which calls this endpoint because the
 * Routes-API server key exists only in the Vercel environment.
 */
export async function GET(req: NextRequest) {
  const authError = validateCronRequest(req)
  if (authError) return authError

  const slug = req.nextUrl.searchParams.get('corridor')
  if (!slug) return NextResponse.json({ error: 'corridor param required' }, { status: 400 })

  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? ''
  if (!apiKey) return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY not set' }, { status: 500 })

  const db = createServiceClient()
  const { data: corridor, error } = await db
    .from('corridors')
    .select('slug, origin_lat, origin_lng, dest_lat, dest_lng, window_start, window_end')
    .eq('slug', slug)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!corridor) return NextResponse.json({ error: `unknown corridor: ${slug}` }, { status: 404 })

  try {
    return NextResponse.json(await samplePredictedCorridor(corridor, apiKey))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
