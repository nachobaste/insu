'use server'

import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder')

export function validateCapacity(
  maxCapacity: number,
  currentCapacity: number,
  requestedAmount: number,
): string | null {
  const remaining = maxCapacity - currentCapacity
  if (remaining <= 0) return 'This tier is at capacity'
  if (requestedAmount > remaining) return `Maximum available: $${remaining.toLocaleString()}`
  return null
}

export async function createHedgerPaymentIntent(
  tierId: string,
): Promise<{ clientSecret: string } | { error: string }> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to purchase protection' }

  const { data: tier, error: tierError } = await supabase
    .from('coverage_tiers')
    .select('*')
    .eq('id', tierId)
    .single()

  if (tierError || !tier) return { error: 'Coverage tier not found' }

  const capacityError = validateCapacity(
    tier.max_capacity_usd,
    tier.current_capacity_usd,
    tier.premium_usd,
  )
  if (capacityError) return { error: capacityError }

  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .select('id, trigger_deadline')
    .eq('id', tier.contract_id)
    .single()

  if (contractError || !contract) return { error: 'Contract not found' }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(Number(tier.premium_usd) * 100),
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    metadata: { position_type: 'hedger', tier_id: tierId, user_id: user.id },
  })

  const { data: position, error: positionError } = await supabase
    .from('hedger_positions')
    .insert({
      user_id: user.id,
      contract_id: tier.contract_id,
      tier_id: tierId,
      premium_paid_usd: tier.premium_usd,
      payout_amount_usd: tier.payout_usd,
      premium_paid_mxn: tier.premium_mxn,
      payout_amount_mxn: tier.payout_mxn,
      currency: 'USD',
      payment_provider: 'stripe',
      payment_intent_id: paymentIntent.id,
      status: 'pending_payment',
      expires_at: contract.trigger_deadline,
    })
    .select('id')
    .single()

  if (positionError || !position) return { error: 'Failed to create position' }

  await stripe.paymentIntents.update(paymentIntent.id, {
    metadata: { position_type: 'hedger', position_id: position.id, tier_id: tierId, user_id: user.id },
  })

  return { clientSecret: paymentIntent.client_secret! }
}

export async function createProviderPaymentIntent(
  tierId: string,
  amountUsd: number,
): Promise<{ clientSecret: string } | { error: string }> {
  if (!amountUsd || amountUsd < 10) return { error: 'Minimum deposit is $10' }

  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to provide capital' }

  const { data: tier, error: tierError } = await supabase
    .from('coverage_tiers')
    .select('*')
    .eq('id', tierId)
    .single()

  if (tierError || !tier) return { error: 'Coverage tier not found' }

  const capacityError = validateCapacity(tier.max_capacity_usd, tier.current_capacity_usd, amountUsd)
  if (capacityError) return { error: capacityError }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amountUsd * 100),
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    metadata: { position_type: 'provider', tier_id: tierId, user_id: user.id },
  })

  const { data: position, error: positionError } = await supabase
    .from('provider_positions')
    .insert({
      user_id: user.id,
      contract_id: tier.contract_id,
      tier_id: tierId,
      capital_deposited_usd: amountUsd,
      capital_deposited_mxn: 0,
      currency: 'USD',
      payment_provider: 'stripe',
      payment_intent_id: paymentIntent.id,
      expected_return_usd: 0,
      expected_return_mxn: 0,
      status: 'pending_payment',
    })
    .select('id')
    .single()

  if (positionError || !position) return { error: 'Failed to create position' }

  await stripe.paymentIntents.update(paymentIntent.id, {
    metadata: { position_type: 'provider', position_id: position.id, tier_id: tierId, user_id: user.id },
  })

  return { clientSecret: paymentIntent.client_secret! }
}
