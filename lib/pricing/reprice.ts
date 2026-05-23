import { createClient } from '@supabase/supabase-js'
import { priceTier } from './engine'
import { computeOracleMultiplier } from '@/lib/oracle/multiplier'
import type { TriggerCondition } from '@/lib/oracle/trigger'
import type { CoverageTier, Contract } from '@/lib/types'

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

async function fetchLatestReading(
  db: DbClient,
  contractId: string,
): Promise<{ value: Record<string, unknown> } | null> {
  const { data } = await db
    .from('oracle_readings')
    .select('value')
    .eq('contract_id', contractId)
    .order('read_at', { ascending: false })
    .limit(1)
  return data?.[0] ?? null
}

async function resolveOracleMultiplier(
  db: DbClient,
  contract: { id: string; trigger_condition: unknown },
): Promise<number> {
  const reading = await fetchLatestReading(db, contract.id)
  const condition = contract.trigger_condition as unknown as TriggerCondition
  return reading ? computeOracleMultiplier(reading, condition) : 1.0
}

async function applyReprice(
  db: DbClient,
  tier: CoverageTier,
  contract: Contract,
  oracleMultiplier: number,
): Promise<void> {
  const oldPremium = tier.premium_usd
  const { premiumUsd, inputs } = priceTier(tier, contract, oracleMultiplier)

  await db.from('coverage_tiers')
    .update({
      premium_usd: premiumUsd,
      last_priced_at: new Date().toISOString(),
      pricing_inputs: inputs,
    })
    .eq('id', tier.id)

  await db.from('pricing_history')
    .insert({
      contract_id: tier.contract_id,
      tier_id: tier.id,
      bs_inputs: inputs,
      bs_output: { premiumUsd },
      premium_usd_before: oldPremium,
      premium_usd_after: premiumUsd,
    })
}

export async function repriceAll(db: DbClient = getClient()): Promise<number> {
  const { data: contracts } = await db
    .from('contracts')
    .select('*, coverage_tiers(*)')
    .eq('status', 'active')

  if (!contracts) return 0

  let count = 0
  for (const contract of contracts) {
    const oracleMultiplier = await resolveOracleMultiplier(db, contract)

    for (const tier of (contract.coverage_tiers ?? []) as CoverageTier[]) {
      await applyReprice(db, tier, contract as unknown as Contract, oracleMultiplier)
      count++
    }
  }
  return count
}

export async function repriceTier(tierId: string, db: DbClient = getClient()): Promise<void> {
  const { data: tier } = await db
    .from('coverage_tiers')
    .select('*')
    .eq('id', tierId)
    .single()

  if (!tier) return

  const { data: contract } = await db
    .from('contracts')
    .select('*')
    .eq('id', tier.contract_id)
    .single()

  if (!contract || contract.status !== 'active') return

  const oracleMultiplier = await resolveOracleMultiplier(db, contract)

  await applyReprice(db, tier as unknown as CoverageTier, contract as unknown as Contract, oracleMultiplier)
}
