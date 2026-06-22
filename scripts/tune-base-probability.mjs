// Read-only analysis: derive a per-corridor DAILY hazard from historical
// oracle_readings = (distinct days with trigger_met) / (distinct days with any reading).
// Pass --apply to UPDATE coverage_tiers.base_probability for recurring contracts.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// minimal .env.local loader (KEY=VALUE, ignores quotes)
const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing SUPABASE url/service key in .env.local')

const APPLY = process.argv.includes('--apply')
const P_MIN = 0.0005
const P_MAX = 0.95
const db = createClient(url, key, { auth: { persistSession: false } })

// 1. recurring contracts
const { data: contracts, error: cErr } = await db
  .from('contracts')
  .select('id, title, trigger_type, is_recurring')
  .in('trigger_type', ['urban', 'nature'])
if (cErr) throw cErr

// 2. paginate readings per contract, build day sets
const PAGE = 1000
async function readingStats(contractId) {
  const allDays = new Set()
  const breachDays = new Set()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('oracle_readings')
      .select('read_at, trigger_met')
      .eq('contract_id', contractId)
      .order('read_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const r of data) {
      const day = new Date(r.read_at).toISOString().slice(0, 10)
      allDays.add(day)
      if (r.trigger_met) breachDays.add(day)
    }
    if (data.length < PAGE) break
  }
  return { totalDays: allDays.size, breachDays: breachDays.size }
}

const rows = []
for (const c of contracts) {
  const { totalDays, breachDays } = await readingStats(c.id)
  const raw = totalDays > 0 ? breachDays / totalDays : null
  const tuned = raw === null ? null : Math.min(P_MAX, Math.max(P_MIN, raw))
  rows.push({ id: c.id, title: c.title, trigger_type: c.trigger_type, totalDays, breachDays, raw, tuned })
}

rows.sort((a, b) => (b.totalDays - a.totalDays))
console.log('\n  corridor                                  type    days  breach   raw      -> tuned p   confidence')
console.log('  ' + '-'.repeat(98))
for (const r of rows) {
  const conf = r.totalDays >= 30 ? 'high' : r.totalDays >= 7 ? 'med' : r.totalDays > 0 ? 'low' : 'NONE'
  const title = (r.title ?? '(untitled)').slice(0, 38).padEnd(38)
  const raw = r.raw === null ? '   n/a' : r.raw.toFixed(4)
  const tuned = r.tuned === null ? '  (keep)' : r.tuned.toFixed(4)
  console.log(`  ${title} ${r.trigger_type.padEnd(7)} ${String(r.totalDays).padStart(4)} ${String(r.breachDays).padStart(6)}   ${raw}   -> ${tuned}    ${conf}`)
}
console.log('')

if (APPLY) {
  let updated = 0, skipped = 0
  for (const r of rows) {
    if (r.tuned === null) { skipped++; continue }            // no history -> leave placeholder
    if (r.totalDays < 7) { skipped++; continue }              // too little data to trust
    const { error } = await db.from('coverage_tiers').update({ base_probability: r.tuned }).eq('contract_id', r.id)
    if (error) { console.error(`  FAIL ${r.title}: ${error.message}`); continue }
    updated++
    console.log(`  applied ${r.tuned.toFixed(4)} -> ${r.title}`)
  }
  console.log(`\n  Done. Updated ${updated} corridor(s); skipped ${skipped} (no/low history, kept 0.05 placeholder).`)
} else {
  console.log('  (dry run — re-run with --apply to write tuned values; corridors with <7 days of data keep the 0.05 placeholder)\n')
}
