'use server'

import Stripe from 'stripe'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { UpsertContractInput } from '@/lib/types'

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? '', { apiVersion: '2023-10-16' as never })
}

async function assertAdmin() {
  const userClient = createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const supabase = createServiceClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if ((profile as { role: string } | null)?.role !== 'admin') throw new Error('Forbidden')
  return { supabase, userId: user.id }
}

export async function upsertContract(input: UpsertContractInput): Promise<string> {
  if (new Date(input.trigger_deadline) <= new Date()) {
    throw new Error('Deadline must be in the future')
  }
  if (input.basic_tier.payout_usd <= input.basic_tier.premium_usd) {
    throw new Error('Payout must exceed premium')
  }
  if (input.premium_tier.payout_usd <= input.premium_tier.premium_usd) {
    throw new Error('Payout must exceed premium')
  }

  const { supabase, userId } = await assertAdmin()

  const contractFields = {
    title: input.title,
    description: input.description,
    category_id: input.category_id,
    status: input.status,
    trigger_type: input.trigger_type,
    trigger_condition: input.trigger_condition,
    trigger_deadline: input.trigger_deadline,
    location: input.location,
    icon_url: input.icon_url,
    is_featured: input.is_featured,
  }

  if (input.id) {
    await supabase.from('contracts').update(contractFields).eq('id', input.id)

    const { data: tiers } = await supabase
      .from('coverage_tiers')
      .select('id, name')
      .eq('contract_id', input.id)

    for (const tier of (tiers ?? []) as Array<{ id: string; name: string }>) {
      const vals = tier.name === 'basic' ? input.basic_tier : input.premium_tier
      await supabase.from('coverage_tiers').update({
        premium_usd: vals.premium_usd,
        payout_usd: vals.payout_usd,
        max_capacity_usd: vals.max_capacity_usd,
      }).eq('id', tier.id)
    }

    return input.id
  }

  const { data: contract } = await supabase
    .from('contracts')
    .insert({ ...contractFields, created_by: userId })
    .select('id')
    .single()

  const contractId = (contract as { id: string }).id

  await supabase.from('coverage_tiers').insert([
    { contract_id: contractId, name: 'basic', ...input.basic_tier },
    { contract_id: contractId, name: 'premium', ...input.premium_tier },
  ])

  return contractId
}

export async function overrideContractTrigger(_args: { contractId: string; outcome: boolean; reason: string }): Promise<void> {
  throw new Error('Not implemented')
}

export async function retryPayout(_payoutId: string): Promise<void> {
  throw new Error('Not implemented')
}
