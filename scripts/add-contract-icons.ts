import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const icons: Record<string, string> = {
  // new seed contracts
  'power-outage-cdmx-2h':         '⚡',
  'waze-heavy-traffic-cdmx':      '🚗',
  'earthquakes-7-june-30':        '🌍',
  'whistler-snow-20cm':           '❄️',
  'bad-bunny-cancelled':          '🎤',
  'cdmx-air-quality-alert':       '🌫️',
  'sao-paulo-metro-shutdown':     '🚇',
  'bogota-water-shortage':        '💧',
  'buenos-aires-blackout':        '🔌',
  'popocatepetl-eruption-alert':  '🌋',
  'caribbean-hurricane-landfall': '🌀',
  'amazon-flood-alert':           '🌊',
  'northern-mexico-drought':      '🌵',
  'cancun-beach-closure':         '🏖️',
  'carnaval-rio-shortened':       '🎭',
  'patagonia-trail-closed':       '🏔️',
  'karol-g-medellin-cancelled':   '🎵',
  'lollapalooza-bsas-cancelled':  '🎸',
  // original demo contracts
  'cdmx-traffic-delay':           '🚗',
  'guadalajara-flash-flood':      '🌧️',
  'cabo-heatwave':                '☀️',
  'cdmx-marathon-rain':           '🏃',
  'oaxaca-food-festival':         '🍜',
  'monterrey-tech-summit':        '💻',
}

async function run() {
  for (const [slug, emoji] of Object.entries(icons)) {
    const { error } = await supabase
      .from('contracts')
      .update({ icon_url: emoji })
      .eq('slug', slug)
    if (error) console.error(`✗ ${slug}: ${error.message}`)
    else console.log(`✓ ${slug} → ${emoji}`)
  }
  console.log('\nDone.')
}

run().catch(console.error)
