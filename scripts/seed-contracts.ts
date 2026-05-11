// scripts/seed-contracts.ts
// Run with: npx ts-node scripts/seed-contracts.ts
// Requires SUPABASE_SERVICE_ROLE_KEY and SEED_ADMIN_USER_ID in .env.local

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // service role bypasses RLS
)

const ADMIN_USER_ID = process.env.SEED_ADMIN_USER_ID!

async function seed() {
  if (!ADMIN_USER_ID) {
    console.error('Error: SEED_ADMIN_USER_ID is not set in .env.local')
    console.error('Create an admin account at /auth/signup, then get the UUID from the Supabase Dashboard → Authentication → Users')
    process.exit(1)
  }

  // Get category IDs
  const { data: cats, error: catsErr } = await supabase.from('categories').select('id, slug')
  if (catsErr) {
    console.error('Failed to load categories:', catsErr.message)
    process.exit(1)
  }
  const catMap = Object.fromEntries((cats ?? []).map((c) => [c.slug, c.id]))

  const contracts = [
    {
      slug: 'power-outage-cdmx-2h',
      title: 'Power outage in CDMX of more than 2 hours?',
      category_id: catMap['urban'],
      trigger_type: 'manual',
      trigger_condition: { type: 'power_outage', min_duration_hours: 2 },
      trigger_deadline: '2026-01-31T23:59:59Z',
      location: { lat: 19.4326, lng: -99.1332, city: 'CDMX', country: 'MX' },
      icon_url: null,
      total_volume_usd: 9_000_000,
      is_featured: true,
      tiers: [
        { name: 'basic',   premium_usd: 100, payout_usd: 500,  premium_mxn: 1700,  payout_mxn: 8500,  base_probability: 0.18 },
        { name: 'premium', premium_usd: 600, payout_usd: 1700, premium_mxn: 10200, payout_mxn: 28900, base_probability: 0.18 },
      ],
    },
    {
      slug: 'waze-heavy-traffic-cdmx',
      title: 'Unusually heavy traffic as reported by Waze?',
      category_id: catMap['urban'],
      trigger_type: 'urban',
      trigger_condition: { type: 'traffic', source: 'waze', index_threshold: 8 },
      trigger_deadline: '2026-06-30T23:59:59Z',
      location: { lat: 19.4326, lng: -99.1332, city: 'CDMX', country: 'MX' },
      icon_url: null,
      total_volume_usd: 9_000_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 50,  payout_usd: 200,  premium_mxn: 850,   payout_mxn: 3400,  base_probability: 0.22 },
        { name: 'premium', premium_usd: 800, payout_usd: 2200, premium_mxn: 13600, payout_mxn: 37400, base_probability: 0.22 },
      ],
    },
    {
      slug: 'earthquakes-7-june-30',
      title: 'How many 7.0+ earthquakes by June 30?',
      category_id: catMap['nature'],
      trigger_type: 'weather',
      trigger_condition: { type: 'earthquake', min_magnitude: 7.0, operator: 'count' },
      trigger_deadline: '2026-06-30T23:59:59Z',
      location: { lat: 19.4326, lng: -99.1332, city: 'CDMX', country: 'MX' },
      icon_url: null,
      total_volume_usd: 583_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 400,  payout_usd: 8000, premium_mxn: 6800,  payout_mxn: 136000, base_probability: 0.05 },
        { name: 'premium', premium_usd: 1000, payout_usd: 4000, premium_mxn: 17000, payout_mxn: 68000,  base_probability: 0.12 },
      ],
    },
    {
      slug: 'whistler-snow-20cm',
      title: 'Less than 20 cm of snow in Whistler?',
      category_id: catMap['experiences'],
      trigger_type: 'weather',
      trigger_condition: { metric: 'snow_cm', threshold: 20, operator: 'lt' },
      trigger_deadline: '2026-03-31T23:59:59Z',
      location: { lat: 50.1163, lng: -122.9574, city: 'Whistler', country: 'CA' },
      icon_url: null,
      total_volume_usd: 98_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 1800, payout_usd: 7000,  premium_mxn: 30600, payout_mxn: 119000, base_probability: 0.24 },
        { name: 'premium', premium_usd: 4000, payout_usd: 16000, premium_mxn: 68000, payout_mxn: 272000, base_probability: 0.24 },
      ],
    },
    {
      slug: 'bad-bunny-cancelled',
      title: 'Bad Bunny concert cancelled?',
      category_id: catMap['events'],
      trigger_type: 'manual',
      trigger_condition: { type: 'event_cancellation', event_name: 'Bad Bunny Concert' },
      trigger_deadline: '2026-12-31T23:59:59Z',
      location: { lat: 19.4326, lng: -99.1332, city: 'CDMX', country: 'MX' },
      icon_url: null,
      total_volume_usd: 9_000_000,
      is_featured: true,
      tiers: [
        { name: 'basic',   premium_usd: 200,  payout_usd: 1400, premium_mxn: 3400,  payout_mxn: 23800, base_probability: 0.04 },
        { name: 'premium', premium_usd: 1000, payout_usd: 4000, premium_mxn: 17000, payout_mxn: 68000, base_probability: 0.04 },
      ],
    },
  ]

  for (const c of contracts) {
    const { tiers, ...contractData } = c
    const { data: contract, error } = await supabase
      .from('contracts')
      .insert({ ...contractData, created_by: ADMIN_USER_ID })
      .select()
      .single()

    if (error) {
      console.error(`Failed to insert contract "${c.slug}":`, error.message)
      continue
    }

    for (const tier of tiers) {
      const { error: tierErr } = await supabase
        .from('coverage_tiers')
        .insert({ ...tier, contract_id: contract.id })

      if (tierErr) console.error(`Tier error for ${c.slug}:`, tierErr.message)
    }

    console.log(`✓ Created: ${c.slug}`)
  }

  console.log('\nSeed complete.')
}

seed().catch(console.error)
