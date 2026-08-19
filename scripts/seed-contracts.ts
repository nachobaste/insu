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

    // ── Urban ────────────────────────────────────────────────────────────────
    {
      slug: 'cdmx-air-quality-alert',
      title: 'Air quality emergency declared in CDMX?',
      category_id: catMap['urban'],
      trigger_type: 'manual',
      trigger_condition: { type: 'air_quality', index_threshold: 150, source: 'SIMAT' },
      trigger_deadline: '2026-12-31T23:59:59Z',
      location: { lat: 19.4326, lng: -99.1332, city: 'CDMX', country: 'MX' },
      icon_url: null,
      total_volume_usd: 4_200_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 80,  payout_usd: 400,  premium_mxn: 1360,  payout_mxn: 6800,  base_probability: 0.20 },
        { name: 'premium', premium_usd: 450, payout_usd: 1500, premium_mxn: 7650,  payout_mxn: 25500, base_probability: 0.20 },
      ],
    },
    {
      slug: 'sao-paulo-metro-shutdown',
      title: 'São Paulo metro line shutdown during rush hour?',
      category_id: catMap['urban'],
      trigger_type: 'urban',
      trigger_condition: { type: 'transit_disruption', min_duration_hours: 1, network: 'metro_sp' },
      trigger_deadline: '2026-09-30T23:59:59Z',
      location: { lat: -23.5505, lng: -46.6333, city: 'São Paulo', country: 'BR' },
      icon_url: null,
      total_volume_usd: 3_100_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 60,  payout_usd: 300,  premium_mxn: 1020, payout_mxn: 5100,  base_probability: 0.28 },
        { name: 'premium', premium_usd: 350, payout_usd: 1200, premium_mxn: 5950, payout_mxn: 20400, base_probability: 0.28 },
      ],
    },
    {
      slug: 'bogota-water-shortage',
      title: 'Water supply cut in Bogotá lasting 6+ hours?',
      category_id: catMap['urban'],
      trigger_type: 'manual',
      trigger_condition: { type: 'water_outage', min_duration_hours: 6 },
      trigger_deadline: '2026-11-30T23:59:59Z',
      location: { lat: 4.7110, lng: -74.0721, city: 'Bogotá', country: 'CO' },
      icon_url: null,
      total_volume_usd: 2_400_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 70,  payout_usd: 350,  premium_mxn: 1190, payout_mxn: 5950,  base_probability: 0.15 },
        { name: 'premium', premium_usd: 400, payout_usd: 1400, premium_mxn: 6800, payout_mxn: 23800, base_probability: 0.15 },
      ],
    },
    {
      slug: 'buenos-aires-blackout',
      title: 'Major blackout in Buenos Aires lasting 3+ hours?',
      category_id: catMap['urban'],
      trigger_type: 'manual',
      trigger_condition: { type: 'power_outage', min_duration_hours: 3, city: 'Buenos Aires' },
      trigger_deadline: '2027-02-28T23:59:59Z',
      location: { lat: -34.6037, lng: -58.3816, city: 'Buenos Aires', country: 'AR' },
      icon_url: null,
      total_volume_usd: 5_800_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 90,  payout_usd: 450,  premium_mxn: 1530, payout_mxn: 7650,  base_probability: 0.16 },
        { name: 'premium', premium_usd: 500, payout_usd: 1800, premium_mxn: 8500, payout_mxn: 30600, base_probability: 0.16 },
      ],
    },

    // ── Nature ───────────────────────────────────────────────────────────────
    {
      slug: 'popocatepetl-eruption-alert',
      title: 'Popocatépetl eruption alert (Yellow Phase 3) issued?',
      category_id: catMap['nature'],
      trigger_type: 'weather',
      trigger_condition: { type: 'volcanic_alert', volcano: 'Popocatepetl', min_phase: 3 },
      trigger_deadline: '2026-12-31T23:59:59Z',
      location: { lat: 19.0228, lng: -98.6277, city: 'CDMX', country: 'MX' },
      icon_url: null,
      total_volume_usd: 1_900_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 150, payout_usd: 3000, premium_mxn: 2550,  payout_mxn: 51000, base_probability: 0.06 },
        { name: 'premium', premium_usd: 700, payout_usd: 7000, premium_mxn: 11900, payout_mxn: 119000, base_probability: 0.06 },
      ],
    },
    {
      slug: 'caribbean-hurricane-landfall',
      title: 'Category 3+ hurricane landfall on Mexican Caribbean coast?',
      category_id: catMap['nature'],
      trigger_type: 'weather',
      trigger_condition: { type: 'hurricane', min_category: 3, region: 'mexican_caribbean' },
      trigger_deadline: '2026-11-30T23:59:59Z',
      location: { lat: 21.1619, lng: -86.8515, city: 'Cancún', country: 'MX' },
      icon_url: null,
      total_volume_usd: 7_500_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 300,  payout_usd: 6000,  premium_mxn: 5100,  payout_mxn: 102000, base_probability: 0.08 },
        { name: 'premium', premium_usd: 1200, payout_usd: 12000, premium_mxn: 20400, payout_mxn: 204000, base_probability: 0.08 },
      ],
    },
    {
      slug: 'amazon-flood-alert',
      title: 'Amazon River flood alert declared in Manaus?',
      category_id: catMap['nature'],
      trigger_type: 'weather',
      trigger_condition: { type: 'flood_alert', river: 'Amazon', city: 'Manaus' },
      trigger_deadline: '2026-07-31T23:59:59Z',
      location: { lat: -3.1019, lng: -60.0250, city: 'Manaus', country: 'BR' },
      icon_url: null,
      total_volume_usd: 920_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 200, payout_usd: 2000, premium_mxn: 3400,  payout_mxn: 34000, base_probability: 0.30 },
        { name: 'premium', premium_usd: 800, payout_usd: 5000, premium_mxn: 13600, payout_mxn: 85000, base_probability: 0.30 },
      ],
    },
    {
      slug: 'northern-mexico-drought',
      title: 'Drought emergency declared in northern Mexico?',
      category_id: catMap['nature'],
      trigger_type: 'weather',
      trigger_condition: { type: 'drought_emergency', region: 'northern_mexico' },
      trigger_deadline: '2026-10-31T23:59:59Z',
      location: { lat: 25.6866, lng: -100.3161, city: 'Monterrey', country: 'MX' },
      icon_url: null,
      total_volume_usd: 680_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 120, payout_usd: 1200, premium_mxn: 2040,  payout_mxn: 20400, base_probability: 0.22 },
        { name: 'premium', premium_usd: 600, payout_usd: 4000, premium_mxn: 10200, payout_mxn: 68000, base_probability: 0.22 },
      ],
    },

    // ── Experiences ──────────────────────────────────────────────────────────
    {
      slug: 'cancun-beach-closure',
      title: 'Cancún hotel zone beaches closed due to sargassum?',
      category_id: catMap['experiences'],
      trigger_type: 'manual',
      trigger_condition: { type: 'beach_closure', cause: 'sargassum', location: 'cancun_hotel_zone' },
      trigger_deadline: '2026-09-30T23:59:59Z',
      location: { lat: 21.1619, lng: -86.8515, city: 'Cancún', country: 'MX' },
      icon_url: null,
      total_volume_usd: 1_450_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 250,  payout_usd: 1000, premium_mxn: 4250,  payout_mxn: 17000, base_probability: 0.35 },
        { name: 'premium', premium_usd: 1500, payout_usd: 6000, premium_mxn: 25500, payout_mxn: 102000, base_probability: 0.35 },
      ],
    },
    {
      slug: 'carnaval-rio-shortened',
      title: 'Rio Carnaval 2027 shortened or cancelled?',
      category_id: catMap['experiences'],
      trigger_type: 'manual',
      trigger_condition: { type: 'event_disruption', event: 'Rio Carnaval 2027' },
      trigger_deadline: '2027-02-28T23:59:59Z',
      location: { lat: -22.9068, lng: -43.1729, city: 'Rio de Janeiro', country: 'BR' },
      icon_url: null,
      total_volume_usd: 3_800_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 180,  payout_usd: 900,  premium_mxn: 3060,  payout_mxn: 15300, base_probability: 0.05 },
        { name: 'premium', premium_usd: 1000, payout_usd: 3500, premium_mxn: 17000, payout_mxn: 59500, base_probability: 0.05 },
      ],
    },
    {
      slug: 'patagonia-trail-closed',
      title: 'Torres del Paine "W Trek" closed for the season?',
      category_id: catMap['experiences'],
      trigger_type: 'manual',
      trigger_condition: { type: 'trail_closure', trail: 'W Trek', park: 'Torres del Paine' },
      trigger_deadline: '2026-11-30T23:59:59Z',
      location: { lat: -50.9423, lng: -73.4068, city: 'Punta Arenas', country: 'CL' },
      icon_url: null,
      total_volume_usd: 540_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 2000, payout_usd: 8000,  premium_mxn: 34000, payout_mxn: 136000, base_probability: 0.18 },
        { name: 'premium', premium_usd: 5000, payout_usd: 20000, premium_mxn: 85000, payout_mxn: 340000, base_probability: 0.18 },
      ],
    },

    // ── Events ───────────────────────────────────────────────────────────────
    {
      slug: 'karol-g-medellin-cancelled',
      title: 'Karol G concert in Medellín cancelled?',
      category_id: catMap['events'],
      trigger_type: 'manual',
      trigger_condition: { type: 'event_cancellation', event_name: 'Karol G Medellín' },
      trigger_deadline: '2026-10-31T23:59:59Z',
      location: { lat: 6.2442, lng: -75.5812, city: 'Medellín', country: 'CO' },
      icon_url: null,
      total_volume_usd: 2_100_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 150, payout_usd: 900,  premium_mxn: 2550,  payout_mxn: 15300, base_probability: 0.05 },
        { name: 'premium', premium_usd: 800, payout_usd: 3200, premium_mxn: 13600, payout_mxn: 54400, base_probability: 0.05 },
      ],
    },
    {
      slug: 'lollapalooza-bsas-cancelled',
      title: 'Lollapalooza Argentina cancelled or postponed?',
      category_id: catMap['events'],
      trigger_type: 'manual',
      trigger_condition: { type: 'event_cancellation', event_name: 'Lollapalooza Argentina' },
      trigger_deadline: '2027-03-31T23:59:59Z',
      location: { lat: -34.6037, lng: -58.3816, city: 'Buenos Aires', country: 'AR' },
      icon_url: null,
      total_volume_usd: 4_600_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 300,  payout_usd: 1500, premium_mxn: 5100,  payout_mxn: 25500, base_probability: 0.06 },
        { name: 'premium', premium_usd: 1500, payout_usd: 5000, premium_mxn: 25500, payout_mxn: 85000, base_probability: 0.06 },
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
      console.error('Failed to insert contract', c.slug, error.message)
      continue
    }

    for (const tier of tiers) {
      const { error: tierErr } = await supabase
        .from('coverage_tiers')
        .insert({ ...tier, contract_id: contract.id })

      if (tierErr) console.error('Tier error for', c.slug, tierErr.message)
    }

    console.log('✓ Created:', c.slug)
  }

  console.log('\nSeed complete.')
}

seed().catch(console.error)
