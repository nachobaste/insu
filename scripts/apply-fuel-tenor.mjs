import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const APPLY = process.argv.includes('--apply')

// Desired end-state per contract.
const PLAN = {
  'gas-price-guatemala-q45': {
    contract: {
      trigger_type: 'fuel',
      is_recurring: true,
      launch_stage: 'live',
      trigger_condition: {
        metric: 'gas_price_quetzales', operator: 'gte', threshold: 45,
        region: 'guatemala', fuel_type: 'regular',
      },
    },
    base_probability: 0.0043,
  },
  'gas-price-magna-cdmx': {
    contract: { is_recurring: true }, // trigger_type/condition already correct
    base_probability: 0.0020,
  },
}

for (const [slug, spec] of Object.entries(PLAN)) {
  const { data: c, error } = await sb.from('contracts').select('id, trigger_type, is_recurring, launch_stage, trigger_condition').eq('slug', slug).single()
  if (error || !c) { console.error(`SKIP ${slug}: ${error?.message ?? 'not found'}`); continue }

  console.log(`\n=== ${slug} (${c.id}) ===`)
  console.log('  current:', JSON.stringify({ trigger_type: c.trigger_type, is_recurring: c.is_recurring, launch_stage: c.launch_stage }))
  console.log('  contract patch:', JSON.stringify(spec.contract))
  console.log(`  base_probability -> ${spec.base_probability} (both tiers)`)

  if (APPLY) {
    const { error: e1 } = await sb.from('contracts').update(spec.contract).eq('id', c.id)
    if (e1) { console.error(`  contract update failed: ${e1.message}`); continue }
    const { error: e2 } = await sb.from('coverage_tiers').update({ base_probability: spec.base_probability }).eq('contract_id', c.id)
    if (e2) { console.error(`  tier update failed: ${e2.message}`); continue }
    console.log('  APPLIED')
  }
}

console.log(APPLY ? '\nDone. Now run a reprice (see Task 7).' : '\nDry run — re-run with --apply to write.')
