import { createClient } from '@supabase/supabase-js'
import { evaluateTrigger, type TriggerCondition } from './trigger'
import { fetchWeatherReading, fetchWazeReading } from './fetcher'
import type { Contract } from '@/lib/types'

interface FetchedReading {
  source: string
  reading_type: string
  value: Record<string, unknown>
}

type ReadingFetcher = (contract: Contract) => Promise<FetchedReading | null>

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

async function defaultFetcher(contract: Contract): Promise<FetchedReading | null> {
  const { lat, lng } = contract.location
  const owmKey = process.env.OPENWEATHERMAP_API_KEY ?? ''

  if (contract.trigger_type === 'weather') {
    return fetchWeatherReading(lat, lng, owmKey)
  }
  if (contract.trigger_type === 'urban') {
    return fetchWazeReading(lat, lng)
  }
  return null
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
      const reading = await readingFetcher(contract)
      if (!reading) continue

      const condition = contract.trigger_condition as unknown as TriggerCondition
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
      count++
    } catch {
      // Log and continue — one failed fetch should not block others
      console.error(`Oracle poll error for contract ${contract.id}`)
    }
  }
  return count
}
