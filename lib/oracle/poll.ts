import { createClient } from '@supabase/supabase-js'
import { evaluateTrigger, type TriggerCondition } from './trigger'
import { fetchWeatherReading, fetchTomorrowReading, fetchGoogleMapsReading } from './fetcher'
import { fetchGasPrice } from './gasFetcher'
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

function isWithinWindow(windowStart: string, windowEnd: string): boolean {
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
      )]
    } catch (err) {
      console.error(`Google Maps fetch error for contract ${contract.id}:`, err)
      return []
    }
  }

  if (contract.trigger_type === 'fuel') {
    const condition = contract.trigger_condition as unknown as {
      fuel_type: 'magna' | 'premium' | 'diesel'
    }
    const VALID_FUEL_TYPES = ['magna', 'premium', 'diesel'] as const
    if (!VALID_FUEL_TYPES.includes(condition.fuel_type as never)) {
      console.error(`Invalid fuel_type "${condition.fuel_type}" for contract ${contract.id}`)
      return []
    }
    try {
      return [await fetchGasPrice(condition.fuel_type)]
    } catch (err) {
      console.error(`CRE fetch error for contract ${contract.id}:`, err)
      return []
    }
  }

  return []
}

export async function pollContracts(
  db: DbClient = getClient(),
  readingFetcher: ReadingFetcher = defaultFetcher,
): Promise<number> {
  const { data: contracts } = await db
    .from('contracts')
    .select('*, corridor:corridors(*)')
    .eq('status', 'active')
    .is('settled_outcome', null)
    .in('trigger_type', ['weather', 'urban', 'fuel'])

  if (!contracts || contracts.length === 0) return 0

  let count = 0
  for (const contract of contracts as Contract[]) {
    try {
      // Urban contracts: skip if no corridor or outside the active window
      if (contract.trigger_type === 'urban') {
        const corridor = contract.corridor as Corridor | null
        if (!corridor) continue
        if (!isWithinWindow(corridor.window_start, corridor.window_end)) continue
      }

      const readings = await readingFetcher(contract)
      if (!readings || readings.length === 0) continue

      const condition = contract.trigger_condition as unknown as TriggerCondition

      for (const reading of readings) {
        const trigger_met = condition.metric
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
