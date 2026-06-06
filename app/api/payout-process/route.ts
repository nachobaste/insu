import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { validateCronRequest } from '@/lib/auth/cronAuth'
import { processPayouts, expireContracts } from '@/lib/payout/processor'

async function handlePayouts(req: NextRequest) {
  const authError = validateCronRequest(req)
  if (authError) return authError
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  const [paid, expired] = await Promise.all([
    processPayouts(db, stripe),
    expireContracts(db),
  ])
  return NextResponse.json({ paid, expired })
}

// Vercel Cron sends GET; POST is kept for manual triggering
export const GET = handlePayouts
export const POST = handlePayouts
