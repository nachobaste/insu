import { createClient } from '@supabase/supabase-js'
import type { Contract, Corridor } from '@/lib/types'
import { isWithinWindow } from './poll'
import {
  fetchTomTomRoute, fetchTomTomIncidents, emptyRoute,
  type TomTomRouteReading, type TomTomIncidentReading, type BBox,
} from './tomtomFetcher'

interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

function getClient(): DbClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  )
}

export interface CrossCheckDeps {
  fetchRoute: (oLat: number, oLng: number, dLat: number, dLng: number) => Promise<TomTomRouteReading>
  fetchIncidents: (bbox: BBox) => Promise<TomTomIncidentReading>
}

function defaultDeps(): CrossCheckDeps {
  const key = process.env.TOMTOM_API_KEY ?? ''
  return {
    fetchRoute: (oLat, oLng, dLat, dLng) => fetchTomTomRoute(oLat, oLng, dLat, dLng, key),
    fetchIncidents: (bbox) => fetchTomTomIncidents(bbox, key),
  }
}

function corridorBBox(c: Corridor): BBox {
  return {
    minLon: Math.min(c.origin_lng, c.dest_lng),
    minLat: Math.min(c.origin_lat, c.dest_lat),
    maxLon: Math.max(c.origin_lng, c.dest_lng),
    maxLat: Math.max(c.origin_lat, c.dest_lat),
  }
}

const GOOGLE_LOOKBACK_MS = 30 * 60 * 1000

export async function runTomTomCrossCheck(
  db: DbClient = getClient(),
  deps: CrossCheckDeps = defaultDeps(),
): Promise<number> {
  const { data: contracts } = await db
    .from('contracts')
    .select('*, corridor:corridors(*)')
    .eq('status', 'active')
    .is('settled_outcome', null)
    .eq('trigger_type', 'urban')
  if (!contracts || contracts.length === 0) return 0

  let count = 0
  for (const contract of contracts as Contract[]) {
    try {
      const corridor = contract.corridor as Corridor | null
      if (!corridor) continue
      if (!isWithinWindow(corridor.window_start, corridor.window_end)) continue

      let route: TomTomRouteReading
      try {
        route = await deps.fetchRoute(corridor.origin_lat, corridor.origin_lng, corridor.dest_lat, corridor.dest_lng)
      } catch {
        route = emptyRoute()
      }

      let incidents: TomTomIncidentReading | null = null
      try {
        incidents = await deps.fetchIncidents(corridorBBox(corridor))
      } catch {
        incidents = null
      }

      const since = new Date(Date.now() - GOOGLE_LOOKBACK_MS).toISOString()
      const { data: gRows } = await db
        .from('oracle_readings')
        .select('value, read_at')
        .eq('contract_id', contract.id)
        .eq('source', 'google_maps')
        .gte('read_at', since)
        .order('read_at', { ascending: false })
        .limit(1)
      const g = (gRows?.[0]?.value ?? null) as Record<string, number> | null
      const gAt = gRows?.[0]?.read_at ?? null

      await db.from('tomtom_crosscheck').insert({
        corridor_id: corridor.id,
        in_window: true,
        tomtom_covered: route.covered,
        tt_live_s: route.liveS,
        tt_free_flow_s: route.freeFlowS,
        tt_historic_s: route.historicS,
        tt_delay_s: route.delayS,
        tt_index_vs_historic: route.indexVsHistoric,
        tt_index_vs_free_flow: route.indexVsFreeFlow,
        tt_incident_count: incidents?.count ?? null,
        tt_incidents: incidents?.byCategory ?? null,
        tt_max_magnitude: incidents?.maxMagnitude ?? null,
        google_duration_s: g?.duration_s ?? null,
        google_baseline_s: g?.baseline_duration_s ?? null,
        google_traffic_index: g?.traffic_index ?? null,
        google_reading_at: gAt,
        raw: { route: route.raw, incidents: incidents?.raw ?? null },
      })
      count++
    } catch {
      console.error(`TomTom cross-check error for contract ${contract.id}`)
    }
  }
  return count
}
