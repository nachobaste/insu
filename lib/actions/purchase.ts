'use server'

import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { validateCapacity } from '@/lib/utils/capacity'
import { computePeriodFactor } from '@/lib/pricing/engine'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder')

export async function createHedgerPaymentIntent(
  tierId: string,
  periodDays?: number,
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
    .select('id, trigger_deadline, created_at')
    .eq('id', tier.contract_id)
    .single()

  if (contractError || !contract) return { error: 'Contract not found' }

  const periodFactor = periodDays ? computePeriodFactor(periodDays, contract) : 1.0
  const periodPremium = Math.round(Number(tier.premium_usd) * periodFactor * 100) / 100

  const coverageEndMs = periodDays
    ? Math.min(
        Date.now() + periodDays * 86_400_000,
        new Date(contract.trigger_deadline).getTime(),
      )
    : new Date(contract.trigger_deadline).getTime()
  const expiresAt = new Date(coverageEndMs).toISOString()

  const amountCents = Math.max(50, Math.round(periodPremium * 100))

  let paymentIntent: Stripe.PaymentIntent
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { position_type: 'hedger', tier_id: tierId, user_id: user.id },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Stripe paymentIntents.create failed:', msg)
    return { error: `Payment error: ${msg}` }
  }

  // coverage_period_days added in migration 20260523000001; cast until Supabase types are regenerated
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hedgerPositions = supabase.from('hedger_positions') as any
  const { data: position, error: positionError } = await hedgerPositions
    .insert({
      user_id: user.id,
      contract_id: tier.contract_id,
      tier_id: tierId,
      premium_paid_usd: periodPremium,
      payout_amount_usd: tier.payout_usd,
      premium_paid_mxn: tier.premium_mxn,
      payout_amount_mxn: tier.payout_mxn,
      currency: 'USD',
      payment_provider: 'stripe',
      payment_intent_id: paymentIntent.id,
      status: 'pending_payment',
      expires_at: expiresAt,
      coverage_period_days: periodDays ?? null,
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

  let paymentIntent: Stripe.PaymentIntent
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount: Math.max(50, Math.round(amountUsd * 100)),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { position_type: 'provider', tier_id: tierId, user_id: user.id },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Stripe paymentIntents.create failed:', msg)
    return { error: `Payment error: ${msg}` }
  }

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
