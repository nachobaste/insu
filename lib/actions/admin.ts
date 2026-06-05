'use server'

import Stripe from 'stripe'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { UpsertContractInput } from '@/lib/types'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key, { apiVersion: '2023-10-16' as never })
}

async function assertAdmin() {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // Require AAL2 (TOTP MFA) for all admin operations (PCI Req 8)
  const { data: aalData } = await userClient.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aalData?.currentLevel !== 'aal2') throw new Error('MFA_REQUIRED')

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
  const { supabase, userId } = await assertAdmin()

  if (!input.is_recurring && input.trigger_deadline && new Date(input.trigger_deadline) <= new Date()) {
    throw new Error('Deadline must be in the future')
  }
  if (input.basic_tier.payout_usd <= input.basic_tier.premium_usd) {
    throw new Error('Payout must exceed premium')
  }
  if (input.premium_tier.payout_usd <= input.premium_tier.premium_usd) {
    throw new Error('Payout must exceed premium')
  }

  const contractFields = {
    title: input.title,
    description: input.description,
    category_id: input.category_id,
    status: input.status,
    trigger_type: input.trigger_type,
    trigger_condition: input.trigger_condition,
    trigger_deadline: input.is_recurring ? null : input.trigger_deadline,
    location: input.location,
    icon_url: input.icon_url,
    is_featured: input.is_featured,
    is_recurring: input.is_recurring,
  }

  if (input.id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('contracts').update(contractFields as any).eq('id', input.id)

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

  const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    + '-' + Date.now().toString(36)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contract, error: contractError } = await (supabase.from('contracts') as any)
    .insert({ ...contractFields, slug, created_by: userId })
    .select('id')
    .single()

  if (contractError) throw new Error(`Failed to create contract: ${contractError.message}`)
  const contractId = (contract as { id: string }).id

  await supabase.from('coverage_tiers').insert([
    { contract_id: contractId, name: 'basic', ...input.basic_tier },
    { contract_id: contractId, name: 'premium', ...input.premium_tier },
  ])

  return contractId
}

export async function overrideContractTrigger({
  contractId,
  outcome,
  reason,
}: {
  contractId: string
  outcome: boolean
  reason: string
}): Promise<void> {
  const { supabase, userId } = await assertAdmin()

  // Guard against double-settlement
  const { data: existing } = await supabase
    .from('contracts')
    .select('status')
    .eq('id', contractId)
    .single()
  if (existing?.status === 'settled') throw new Error('Contract is already settled')

  await supabase.from('contracts').update({
    settled_outcome: outcome,
    status: 'settled',
    settled_at: new Date().toISOString(),
  }).eq('id', contractId)

  if (!outcome) {
    await supabase
      .from('hedger_positions')
      .update({ status: 'settled_no_payout' })
      .eq('contract_id', contractId)
      .eq('status', 'active')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('admin_audit_log') as any).insert({
      admin_id: userId,
      action: 'trigger_override',
      contract_id: contractId,
      reason,
      metadata: { outcome },
    })
    return
  }

  const { data: positions } = await supabase
    .from('hedger_positions')
    .select('*')
    .eq('contract_id', contractId)
    .eq('status', 'active')

  if (!positions || (positions as unknown[]).length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('admin_audit_log') as any).insert({
      admin_id: userId,
      action: 'trigger_override',
      contract_id: contractId,
      reason,
      metadata: { outcome },
    })
    return
  }

  const stripe = getStripe()

  for (const position of positions as Array<{
    id: string; user_id: string; payout_amount_usd: number
    payout_amount_mxn: number; currency: string
  }>) {
    const { data: newPayout } = await supabase.from('payouts').insert({
      contract_id: contractId,
      hedger_position_id: position.id,
      amount_usd: position.payout_amount_usd,
      amount_mxn: position.payout_amount_mxn,
      currency: position.currency,
      payment_provider: 'stripe',
      status: 'processing',
    }).select('id').single()

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', position.user_id)
        .single()

      let customerId = (profile as { stripe_customer_id: string | null } | null)?.stripe_customer_id
      if (!customerId) {
        const customer = await stripe.customers.create({ metadata: { user_id: position.user_id } })
        customerId = customer.id
        await supabase.from('profiles').update({ stripe_customer_id: customerId }).eq('id', position.user_id)
      }

      const txn = await stripe.customers.createBalanceTransaction(customerId, {
        amount: -Math.round(position.payout_amount_usd * 100),
        currency: 'usd',
      })

      await supabase.from('payouts').update({
        status: 'completed',
        transfer_id: txn.id,
        completed_at: new Date().toISOString(),
      }).eq('id', (newPayout as { id: string }).id)

      await supabase.from('hedger_positions').update({ status: 'paid_out' }).eq('id', position.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Payout failed for position ${position.id}:`, msg)
      await supabase.from('payouts').update({ status: 'failed' }).eq('id', (newPayout as { id: string }).id)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('admin_audit_log') as any).insert({
    admin_id: userId,
    action: 'trigger_override',
    contract_id: contractId,
    reason,
    metadata: { outcome },
  })
}

export async function retryPayout(payoutId: string): Promise<void> {
  const { supabase } = await assertAdmin()

  const { data: payout, error } = await supabase
    .from('payouts')
    .select('*, hedger_positions(user_id, id)')
    .eq('id', payoutId)
    .single()

  if (error || !payout) throw new Error('Payout not found')

  const p = payout as {
    id: string; amount_usd: number; currency: string; status: string; transfer_id: string | null
    hedger_positions: { user_id: string; id: string }
  }

  if (p.status === 'completed') throw new Error('Payout already completed')
  if (p.status === 'processing') throw new Error('Payout is already processing — check Stripe dashboard before retrying')
  if (p.transfer_id) throw new Error('Transfer already issued — check Stripe dashboard before retrying')

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', p.hedger_positions.user_id)
    .single()

  const stripe = getStripe()
  let customerId = (profile as { stripe_customer_id: string | null } | null)?.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({ metadata: { user_id: p.hedger_positions.user_id } })
    customerId = customer.id
    await supabase.from('profiles').update({ stripe_customer_id: customerId }).eq('id', p.hedger_positions.user_id)
  }

  const txn = await stripe.customers.createBalanceTransaction(customerId, {
    amount: -Math.round(p.amount_usd * 100),
    currency: 'usd',
  })

  await supabase.from('payouts').update({
    status: 'completed',
    transfer_id: txn.id,
    completed_at: new Date().toISOString(),
  }).eq('id', payoutId)

  await supabase.from('hedger_positions').update({ status: 'paid_out' }).eq('id', p.hedger_positions.id)
}
