'use server'

import Stripe from 'stripe'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { validateProviderCapacity, validateBuyerCapacity } from '@/lib/utils/capacity'
import { dailyHazard, priceTenor, capacityFactor } from '@/lib/pricing/derivative'
import { createNotification } from '@/lib/notifications/create'
import { marketDay, marketDayStartUtc } from '@/lib/utils/marketDay'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key)
}

export async function createHedgerPaymentIntent(
  tierId: string,
  periodDays?: number,
): Promise<{ clientSecret: string; expiresAt: string } | { error: string }> {
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

  if (tierError || !tier) return { error: 'Protection tier not found' }

  const capacityError = validateBuyerCapacity(tier.current_capacity_usd, tier.max_payouts * tier.payout_usd)
  if (capacityError) return { error: capacityError }

  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .select('id, is_recurring, trigger_condition, trigger_deadline, created_at')
    .eq('id', tier.contract_id)
    .single()

  if (contractError || !contract) return { error: 'Contract not found' }

  const isRecurring = contract.is_recurring

  // A position must never cover an event that already happened: settlement
  // buckets recurring trigger-days by market-local date, so a purchase made
  // after today's trigger would collect immediately for an event it never
  // covered. One-time contracts stay blocked from first trigger until
  // settlement.
  const firedQuery = supabase
    .from('oracle_readings')
    .select('id')
    .eq('contract_id', contract.id)
    .eq('trigger_met', true)
  const { data: fired } = isRecurring
    ? await firedQuery.gte('read_at', marketDayStartUtc(marketDay(new Date()))).limit(1)
    : await firedQuery.limit(1)
  if (fired && fired.length > 0) {
    return {
      error: isRecurring
        ? 'This protection already triggered today — purchases reopen tomorrow.'
        : 'This contract has already triggered and is awaiting settlement.',
    }
  }

  let periodPremium: number
  let expiresAt: string
  let reservedUsd: number
  let payoutsRemaining: number

  if (isRecurring) {
    if (!periodDays) return { error: 'Choose a protection period' }
    const { data: latest } = await supabase
      .from('oracle_readings')
      .select('value, trigger_met')
      .eq('contract_id', contract.id)
      .order('read_at', { ascending: false })
      .limit(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reading = (latest?.[0] ?? null) as any
    // Covers the cross-UTC-midnight gap the day-scoped gate above misses:
    // an active window can straddle 00:00 UTC, so the latest reading may
    // still show a live trigger before any reading lands on the new UTC day
    if (reading?.trigger_met) {
      return { error: 'The trigger is currently active — purchases reopen once conditions clear.' }
    }
    const p = dailyHazard(
      Number(tier.base_probability),
      reading,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contract.trigger_condition as any,
    )
    const cap = capacityFactor(tier.current_capacity_usd, tier.max_capacity_usd)
    periodPremium = priceTenor(tier.payout_usd, periodDays, p, tier.max_payouts, { capacityFactor: cap }).premiumUsd
    expiresAt = new Date(Date.now() + periodDays * 86_400_000).toISOString()
    reservedUsd = tier.max_payouts * tier.payout_usd
    payoutsRemaining = tier.max_payouts
  } else {
    periodPremium = Math.round(Number(tier.premium_usd) * 100) / 100
    expiresAt = new Date(contract.trigger_deadline!).getTime() > Date.now()
      ? new Date(contract.trigger_deadline!).toISOString()
      : new Date().toISOString()
    reservedUsd = tier.payout_usd
    payoutsRemaining = 1
  }

  const amountCents = Math.max(50, Math.round(periodPremium * 100))

  let paymentIntent: Stripe.PaymentIntent
  try {
    paymentIntent = await getStripe().paymentIntents.create({
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
      coverage_period_days: isRecurring ? periodDays : null,
      reserved_usd: reservedUsd,
      payouts_remaining: payoutsRemaining,
    })
    .select('id')
    .single()

  if (positionError || !position) {
    console.error('hedger_positions insert failed:', positionError)
    return { error: `Failed to create position: ${positionError?.message ?? 'unknown'}` }
  }

  await getStripe().paymentIntents.update(paymentIntent.id, {
    metadata: { position_type: 'hedger', position_id: position.id, tier_id: tierId, user_id: user.id },
  })

  return { clientSecret: paymentIntent.client_secret!, expiresAt }
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

  if (tierError || !tier) return { error: 'Protection tier not found' }

  const capacityError = validateProviderCapacity(tier.max_capacity_usd, tier.current_capacity_usd, amountUsd)
  if (capacityError) return { error: capacityError }

  let paymentIntent: Stripe.PaymentIntent
  try {
    paymentIntent = await getStripe().paymentIntents.create({
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

  await getStripe().paymentIntents.update(paymentIntent.id, {
    metadata: { position_type: 'provider', position_id: position.id, tier_id: tierId, user_id: user.id },
  })

  return { clientSecret: paymentIntent.client_secret! }
}

export async function activatePositionByPaymentIntent(
  clientSecret: string,
): Promise<{ ok: true; positionId: string } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  // clientSecret format: pi_xxx_secret_yyy — extract the PI id
  const paymentIntentId = clientSecret.split('_secret_')[0]
  if (!paymentIntentId) return { error: 'Invalid client secret' }

  // Verify payment succeeded with Stripe before activating
  let pi: Stripe.PaymentIntent
  try {
    pi = await getStripe().paymentIntents.retrieve(paymentIntentId)
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
      .eq('status', 'pending_payment')
      .select('tier_id, premium_paid_usd, contract_id')
      .single()

    let contractId: string
    if (updateError || !position) {
      // The Stripe webhook may have won the race and already activated this
      // position — that's a success for the buyer, not a failure. It also
      // means the webhook already counted the volume, so don't count it again.
      const { data: existing } = await db
        .from('hedger_positions')
        .select('status, user_id, contract_id')
        .eq('id', position_id)
        .single()

      if (!existing || existing.user_id !== user.id || existing.status !== 'active') {
        console.error('hedger_positions update failed:', updateError, 'position_id:', position_id, 'user_id:', user.id)
        return { error: `Failed to activate position: ${updateError?.message ?? 'no row matched'}` }
      }
      contractId = existing.contract_id
    } else {
      contractId = position.contract_id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db.rpc as any)('increment_contract_volume', {
        p_contract_id: position.contract_id,
        p_amount: position.premium_paid_usd,
      })
    }

    await createNotification(db, {
      userId: user.id,
      type: 'protection_purchased',
      title: 'Protection active',
      body: `Your protection is now active and covering you. Confirmation #${position_id.slice(0, 8).toUpperCase()}.`,
      contractId,
    })
  } else {
    const { data: providerPosition, error: providerError } = await db
      .from('provider_positions')
      .update({ status: 'active' })
      .eq('id', position_id)
      .eq('user_id', user.id)
      .select('tier_id, capital_deposited_usd')
      .single()

    if (providerError || !providerPosition) {
      return { error: `Failed to activate position: ${providerError?.message ?? 'no row matched'}` }
    }

    // Provider deposit fills the pool — increment capacity by the deposited amount.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.rpc as any)('increment_tier_capacity', {
      p_tier_id: providerPosition.tier_id,
      p_amount: providerPosition.capital_deposited_usd,
    })
  }

  revalidatePath('/dashboard')
  return { ok: true, positionId: position_id }
}
