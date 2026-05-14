import { createClient } from '@supabase/supabase-js'
import { priceTier } from './engine'
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

async function applyReprice(db: DbClient, tier: CoverageTier, contract: Contract): Promise<void> {
  const oldPremium = tier.premium_usd
  const { premiumUsd, inputs } = priceTier(tier, contract)

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
    for (const tier of (contract.coverage_tiers ?? []) as CoverageTier[]) {
      await applyReprice(db, tier, contract as unknown as Contract)
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

  await applyReprice(db, tier as unknown as CoverageTier, contract as unknown as Contract)
}
