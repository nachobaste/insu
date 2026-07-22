import { trafficIndex } from './trafficIndex'

const ROUTING_BASE = 'https://api.tomtom.com/routing/1/calculateRoute'

export interface TomTomRouteReading {
  covered: boolean
  liveS: number | null
  freeFlowS: number | null
  historicS: number | null
  delayS: number | null
  indexVsHistoric: number | null
  indexVsFreeFlow: number | null
  raw: unknown
}

const EMPTY_ROUTE: Omit<TomTomRouteReading, 'raw'> = {
  covered: false, liveS: null, freeFlowS: null, historicS: null,
  delayS: null, indexVsHistoric: null, indexVsFreeFlow: null,
}

/** Normalized "no route" reading — reused by the orchestrator's error path. */
export function emptyRoute(raw: unknown = null): TomTomRouteReading {
  return { ...EMPTY_ROUTE, raw }
}

export async function fetchTomTomRoute(
  originLat: number, originLng: number,
  destLat: number, destLng: number,
  apiKey: string,
): Promise<TomTomRouteReading> {
  const path = `${originLat},${originLng}:${destLat},${destLng}`
  const url = `${ROUTING_BASE}/${path}/json?computeTravelTimeFor=all&key=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`TomTom Routing error: ${res.status}`)
  const data = await res.json()
  const summary = data?.routes?.[0]?.summary as Record<string, number> | undefined
  if (!summary || typeof summary.travelTimeInSeconds !== 'number') return emptyRoute(data)

  const liveS = summary.travelTimeInSeconds
  const freeFlowS = summary.noTrafficTravelTimeInSeconds ?? null
  const historicS = summary.historicTrafficTravelTimeInSeconds ?? null
  return {
    covered: true,
    liveS,
    freeFlowS,
    historicS,
    delayS: summary.trafficDelayInSeconds ?? null,
    indexVsHistoric: historicS ? trafficIndex(liveS, historicS) : null,
    indexVsFreeFlow: freeFlowS ? trafficIndex(liveS, freeFlowS) : null,
    raw: data,
  }
}

export interface BBox { minLon: number; minLat: number; maxLon: number; maxLat: number }

export interface TomTomIncidentReading {
  count: number
  byCategory: Record<string, number>
  maxMagnitude: number | null
  raw: unknown
}

const INCIDENTS_BASE = 'https://api.tomtom.com/traffic/services/5/incidentDetails'
const INCIDENT_FIELDS =
  '{incidents{type,properties{iconCategory,magnitudeOfDelay,delay,length,startTime,endTime,roadNumbers}}}'

// iconCategory codes per TomTom Traffic Incidents v5.
const INCIDENT_CATEGORIES: Record<number, string> = {
  0: 'unknown', 1: 'accident', 2: 'fog', 3: 'dangerous_conditions', 4: 'rain',
  5: 'ice', 6: 'jam', 7: 'lane_closed', 8: 'road_closed', 9: 'road_works',
  10: 'wind', 11: 'flooding', 14: 'broken_down_vehicle',
}

export async function fetchTomTomIncidents(bbox: BBox, apiKey: string): Promise<TomTomIncidentReading> {
  const params = new URLSearchParams({
    key: apiKey,
    bbox: `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
    fields: INCIDENT_FIELDS,
    language: 'en-GB',
    timeValidityFilter: 'present',
  })
  const res = await fetch(`${INCIDENTS_BASE}?${params.toString()}`)
  if (!res.ok) throw new Error(`TomTom Incidents error: ${res.status}`)
  const data = await res.json()
  const incidents = (data?.incidents ?? []) as Array<{
    properties?: { iconCategory?: number; magnitudeOfDelay?: number }
  }>

  const byCategory: Record<string, number> = {}
  let maxMagnitude: number | null = null
  for (const inc of incidents) {
    const cat = INCIDENT_CATEGORIES[inc.properties?.iconCategory ?? 0] ?? 'unknown'
    byCategory[cat] = (byCategory[cat] ?? 0) + 1
    const mag = inc.properties?.magnitudeOfDelay
    if (typeof mag === 'number') maxMagnitude = maxMagnitude === null ? mag : Math.max(maxMagnitude, mag)
  }
  return { count: incidents.length, byCategory, maxMagnitude, raw: data }
}
