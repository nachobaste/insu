import { createClient } from '@supabase/supabase-js'
import { evaluateTrigger, type TriggerCondition } from './trigger'
import { fetchWeatherReading, fetchTomorrowReading, fetchWazeReading } from './fetcher'
import type { Contract } from '@/lib/types'

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

async function defaultFetcher(contract: Contract): Promise<FetchedReading[]> {
  const { lat, lng } = contract.location
  const readings: FetchedReading[] = []

  if (contract.trigger_type === 'weather') {
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
  } else if (contract.trigger_type === 'urban') {
    readings.push(fetchWazeReading(lat, lng))
  }

  return readings
}

export async function pollContracts(
  db: DbClient = getClient(),
  readingFetcher: ReadingFetcher = defaultFetcher,
): Promise<number> {
  const { data: contracts } = await db
    .from('contracts')
    .select('*')
    .eq('status', 'active')
    .is('settled_outcome', null)
    .in('trigger_type', ['weather', 'urban'])

  if (!contracts || contracts.length === 0) return 0

  let count = 0
  for (const contract of contracts as Contract[]) {
    try {
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
