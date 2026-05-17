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
      const { data: position } = await supabase
        .from('hedger_positions')
        .update({ status: 'active' })
        .eq('id', position_id)
        .select('tier_id, premium_paid_usd, contract_id')
        .single()

      if (position) {
        const { data: tier } = await supabase
          .from('coverage_tiers')
          .select('current_capacity_usd')
          .eq('id', position.tier_id)
          .single()

        if (tier) {
          await supabase
            .from('coverage_tiers')
            .update({ current_capacity_usd: tier.current_capacity_usd + position.premium_paid_usd })
            .eq('id', position.tier_id)
        }

        const { data: contract } = await supabase
          .from('contracts')
          .select('total_volume_usd')
          .eq('id', position.contract_id)
          .single()

        if (contract) {
          await supabase
            .from('contracts')
            .update({ total_volume_usd: contract.total_volume_usd + position.premium_paid_usd })
            .eq('id', position.contract_id)
        }
      }
    } else if (position_type === 'provider') {
      await supabase
        .from('provider_positions')
        .update({ status: 'active' })
        .eq('id', position_id)
    }
  }

  return NextResponse.json({ received: true })
}
