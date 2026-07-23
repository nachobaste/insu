import { createClient } from '@supabase/supabase-js'
import { evaluateTrigger, type TriggerCondition } from './trigger'
import { fetchWeatherReading, fetchTomorrowReading, fetchGoogleMapsReading, fetchCorridorPolyline, fetchAirQualityReading, fetchFloodReading } from './fetcher'
import { fetchGasPrice } from './gasFetcher'
import { fetchGuatemalaFuelPrice } from './guatemalaFuelFetcher'
import type { Contract, Corridor } from '@/lib/types'

interface FetchedReading {
  source: string
  reading_type: string
  value: Record<string, unknown>
}

type ReadingFetcher = (contract: Contract) => Promise<FetchedReading[]>

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

export function isWithinWindow(windowStart: string, windowEnd: string): boolean {
  // Mexico City abolished DST in 2023 — permanently UTC-6.
  const mexicoCityTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())

  const [nowH, nowM] = mexicoCityTime.split(':').map(Number)
  const nowMinutes = nowH * 60 + nowM
  const [startH, startM] = windowStart.substring(0, 5).split(':').map(Number)
  const [endH, endM] = windowEnd.substring(0, 5).split(':').map(Number)
  return nowMinutes >= startH * 60 + startM && nowMinutes < endH * 60 + endM
}

async function defaultFetcher(contract: Contract): Promise<FetchedReading[]> {
  if (contract.trigger_type === 'weather') {
    const readings: FetchedReading[] = []
    const { lat, lng } = contract.location

    const owmKey = process.env.OPENWEATHERMAP_API_KEY ?? ''
    if (owmKey) {
      try {
        readings.push(await fetchWeatherReading(lat, lng, owmKey))
      } catch (err) {
        console.error(`OpenWeatherMap fetch error for contract ${contract.id}:`, err)
      }
    }

    const tioKey = process.env.TOMORROW_IO_API_KEY ?? ''
    if (tioKey) {
      try {
        readings.push(await fetchTomorrowReading(lat, lng, tioKey))
      } catch (err) {
        console.error(`Tomorrow.io fetch error for contract ${contract.id}:`, err)
      }
    }

    return readings
  }

  if (contract.trigger_type === 'urban') {
    const corridor = contract.corridor as Corridor | null
    if (!corridor) return []

    const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? ''
    if (!apiKey) return []

    try {
      return [await fetchGoogleMapsReading(
        corridor.origin_lat, corridor.origin_lng,
        corridor.dest_lat, corridor.dest_lng,
        apiKey,
        corridor.baseline_duration_s,
      )]
    } catch (err) {
      console.error(`Google Maps fetch error for contract ${contract.id}:`, err)
      return []
    }
  }

  if (contract.trigger_type === 'fuel') {
    const condition = contract.trigger_condition as unknown as {
      fuel_type: 'magna' | 'premium' | 'diesel' | 'regular'
      region?: string
    }
    try {
      if (condition.region === 'guatemala') {
        if (condition.fuel_type !== 'regular') {
          console.error(`Invalid GT fuel_type "${condition.fuel_type}" for contract ${contract.id}`)
          return []
        }
        return [await fetchGuatemalaFuelPrice(condition.fuel_type)]
      }
      const VALID_FUEL_TYPES = ['magna', 'premium', 'diesel'] as const
      if (!VALID_FUEL_TYPES.includes(condition.fuel_type as never)) {
        console.error(`Invalid fuel_type "${condition.fuel_type}" for contract ${contract.id}`)
        return []
      }
      return [await fetchGasPrice(condition.fuel_type as 'magna' | 'premium' | 'diesel')]
    } catch (err) {
      console.error(`Fuel fetch error for contract ${contract.id}:`, err)
      return []
    }
  }

  if (contract.trigger_type === 'air_quality') {
    const apiKey = process.env.OPENWEATHERMAP_API_KEY ?? ''
    if (!apiKey) return []
    const { lat, lng } = contract.location
    try {
      return [await fetchAirQualityReading(lat, lng, apiKey)]
    } catch (err) {
      console.error(`Air-quality fetch error for contract ${contract.id}:`, err)
      return []
    }
  }

  if (contract.trigger_type === 'flood') {
    const apiKey = process.env.OPENWEATHERMAP_API_KEY ?? ''
    if (!apiKey) return []
    const { lat, lng } = contract.location
    try {
      return [await fetchFloodReading(lat, lng, apiKey)]
    } catch (err) {
      console.error(`Flood fetch error for contract ${contract.id}:`, err)
      return []
    }
  }

  return []
}

/** Trigger types this poller knows how to fetch readings for. */
export const POLLABLE_TRIGGER_TYPES = ['weather', 'urban', 'fuel', 'air_quality', 'flood'] as const

interface CorridorGeo {
  id: string
  origin_lat: number
  origin_lng: number
  dest_lat: number
  dest_lng: number
}
type PolylineFetcher = (c: CorridorGeo) => Promise<string>

async function defaultPolylineFetcher(c: CorridorGeo): Promise<string> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? ''
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY not set')
  return fetchCorridorPolyline(c.origin_lat, c.origin_lng, c.dest_lat, c.dest_lng, apiKey)
}

/**
 * Backfill the static road-route polyline for any corridor missing one. Not
 * window-gated (geometry doesn't change with time of day) and idempotent — only
 * fills NULLs, so it's a cheap no-op once populated. Returns rows filled.
 */
export async function ensureCorridorPolylines(
  db: DbClient = getClient(),
  fetcher: PolylineFetcher = defaultPolylineFetcher,
): Promise<number> {
  const { data: corridors } = await db
    .from('corridors')
    .select('id, origin_lat, origin_lng, dest_lat, dest_lng')
    .is('path_polyline', null)

  if (!corridors || corridors.length === 0) return 0

  let count = 0
  for (const c of corridors as CorridorGeo[]) {
    try {
      const encoded = await fetcher(c)
      await db.from('corridors').update({ path_polyline: encoded }).eq('id', c.id)
      count++
    } catch (err) {
      console.error(`Polyline backfill error for corridor ${c.id}:`, err)
    }
  }
  return count
}

export async function pollContracts(
  db: DbClient = getClient(),
  readingFetcher: ReadingFetcher = defaultFetcher,
  triggerTypes: string[] = [...POLLABLE_TRIGGER_TYPES],
): Promise<number> {
  const { data: contracts } = await db
    .from('contracts')
    .select('*, corridor:corridors(*)')
    .eq('status', 'active')
    .is('settled_outcome', null)
    .in('trigger_type', triggerTypes)

  if (!contracts || contracts.length === 0) return 0

  let count = 0
  for (const contract of contracts as Contract[]) {
    try {
      // Urban contracts: skip if no corridor or outside the active window
      let corridorBaselineS: number | null = null
      if (contract.trigger_type === 'urban') {
        const corridor = contract.corridor as Corridor | null
        if (!corridor) continue
        if (!isWithinWindow(corridor.window_start, corridor.window_end)) continue
        corridorBaselineS = corridor.baseline_duration_s ?? null
      }

      const readings = await readingFetcher(contract)
      if (!readings || readings.length === 0) continue

      const condition = contract.trigger_condition as unknown as TriggerCondition

      // Urban triggers are only meaningful against a computed rush-hour
      // baseline; against the free-flow fallback every ordinary rush hour
      // reads as extraordinary. Keep recording readings (they build the
      // baseline history) but never fire until one exists.
      const canEvaluate =
        contract.trigger_type !== 'urban' || (corridorBaselineS ?? 0) > 0

      for (const reading of readings) {
        const trigger_met = condition.metric && canEvaluate
          ? evaluateTrigger(condition, reading.value)
          : false

        await db.from('oracle_readings').insert({
          contract_id: contract.id,
          source: reading.source,
          reading_type: reading.reading_type,
          value: reading.value,
          trigger_met,
        })
      }
      count++
    } catch {
      console.error(`Oracle poll error for contract ${contract.id}`)
    }
  }
  return count
}
