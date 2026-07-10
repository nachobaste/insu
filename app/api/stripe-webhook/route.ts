import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    )
  } catch (err) {
    return NextResponse.json({ error: `Webhook error: ${(err as Error).message}` }, { status: 400 })
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent
    const { position_type, position_id } = pi.metadata ?? {}

    if (!position_id || !position_type) {
      return NextResponse.json({ error: 'Missing metadata' }, { status: 400 })
    }

    if (position_type === 'hedger') {
      // Fallback activation only: the buyer's activation server action is the
      // primary path and may have already run — guard on status so the two
      // never both activate (and double-count volume) for the same position.
      const { data: position } = await supabase
        .from('hedger_positions')
        .update({ status: 'active' })
        .eq('id', position_id)
        .eq('payment_intent_id', pi.id)
        .eq('status', 'pending_payment')
        .select('tier_id, premium_paid_usd, contract_id')
        .single()

      if (position) {
        // Pool capacity comes from provider deposits, never from premiums —
        // matching the server action's activation path.
        await supabase.rpc('increment_contract_volume', {
          p_contract_id: position.contract_id,
          p_amount: position.premium_paid_usd,
        })
      }
    } else if (position_type === 'provider') {
      await supabase
        .from('provider_positions')
        .update({ status: 'active' })
        .eq('id', position_id)
        .eq('payment_intent_id', pi.id)
    }
  }

  return NextResponse.json({ received: true })
}
