'use server'

import Stripe from 'stripe'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { validateCapacity } from '@/lib/utils/capacity'
import { computePeriodFactor } from '@/lib/pricing/engine'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder')

export async function createHedgerPaymentIntent(
  tierId: string,
  periodDays?: number,
): Promise<{ clientSecret: string } | { error: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to purchase protection' }

  // Prevent flood: cap pending purchases at 5 per user
  const { count: pendingCount, error: countError } = await supabase
    .from('hedger_positions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'pending_payment')
  if (countError) return { error: 'Unable to verify pending purchases. Please try again.' }
  if ((pendingCount ?? 0) >= 5) {
    return { error: 'You have too many pending purchases. Complete or cancel them before buying again.' }
  }

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

  if (positionError || !position) {
    console.error('hedger_positions insert failed:', positionError)
    return { error: `Failed to create position: ${positionError?.message ?? 'unknown'}` }
  }

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

  const supabase = await createClient()

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

export async function activatePositionByPaymentIntent(
  clientSecret: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  // clientSecret format: pi_xxx_secret_yyy — extract the PI id
  const paymentIntentId = clientSecret.split('_secret_')[0]
  if (!paymentIntentId) return { error: 'Invalid client secret' }

  // Verify payment succeeded with Stripe before activating
  let pi: Stripe.PaymentIntent
  try {
    pi = await stripe.paymentIntents.retrieve(paymentIntentId)
  } catch {
    return { error: 'Could not verify payment' }
  }
  if (pi.status !== 'succeeded' && pi.status !== 'processing') {
    return { error: `Payment not confirmed (status: ${pi.status})` }
  }

  const { position_type, position_id } = pi.metadata ?? {}
  if (!position_id || !position_type) return { error: 'Missing position metadata' }

  // Use service role to bypass RLS for status update
  const db = createServiceClient()

  if (position_type === 'hedger') {
    const { data: position, error: updateError } = await db
      .from('hedger_positions')
      .update({ status: 'active' })
      .eq('id', position_id)
      .eq('user_id', user.id)
      .select('tier_id, premium_paid_usd, contract_id')
      .single()

    if (updateError || !position) {
      console.error('hedger_positions update failed:', updateError, 'position_id:', position_id, 'user_id:', user.id)
      return { error: `Failed to activate position: ${updateError?.message ?? 'no row matched'}` }
    }

    if (position) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db.rpc as any)('increment_tier_capacity', {
        p_tier_id: position.tier_id,
        p_amount: position.premium_paid_usd,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db.rpc as any)('increment_contract_volume', {
        p_contract_id: position.contract_id,
        p_amount: position.premium_paid_usd,
      })
    }
  } else {
    await db
      .from('provider_positions')
      .update({ status: 'active' })
      .eq('id', position_id)
      .eq('user_id', user.id)
  }

  revalidatePath('/dashboard')
  return { ok: true }
}
