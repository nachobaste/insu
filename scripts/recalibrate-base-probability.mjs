// scripts/recalibrate-base-probability.mjs
// Per urban contract WITH a corridor baseline_duration_s: recompute daily breach
// frequency under the NEW baseline and write coverage_tiers.base_probability.
// Mirrors the canonical formula in lib/oracle/trafficIndex.ts (inlined below).
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = { ...process.env }
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* rely on process.env */ }
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing Supabase creds. Aborting.'); process.exit(2) }

const APPLY = process.argv.includes('--apply')
const P_MIN = 0.0005, P_MAX = 0.95, MIN_DAYS = 7
const TRAFFIC_INDEX_MAX = 100 // keep in sync with lib/oracle/trafficIndex.ts
const db = createClient(url, key, { auth: { persistSession: false } })

// Canonical traffic-index formula (mirror of lib/oracle/trafficIndex.ts).
function trafficIndex(durationS, baselineS) {
  if (!baselineS || baselineS <= 0) return 0
  const raw = ((durationS / baselineS) - 1) * 100
  return Math.min(TRAFFIC_INDEX_MAX, Math.max(0, Math.round(raw)))
}

const { data: contracts, error: cErr } = await db
  .from('contracts')
  .select('id, title, corridor_id, trigger_condition, corridor:corridors(baseline_duration_s)')
  .eq('trigger_type', 'urban')
if (cErr) throw cErr

const PAGE = 1000
async function breachStats(contractId, baselineS, threshold) {
  const allDays = new Set(), breachDays = new Set()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('oracle_readings').select('read_at, value')
      .eq('contract_id', contractId)
      .order('read_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const r of data) {
      const dur = Number(r.value?.duration_s)
      if (!Number.isFinite(dur) || dur <= 0) continue
      const day = new Date(r.read_at).toISOString().slice(0, 10)
      allDays.add(day)
      if (trafficIndex(dur, baselineS) > threshold) breachDays.add(day)
    }
    if (data.length < PAGE) break
  }
  return { totalDays: allDays.size, breachDays: breachDays.size }
}

const rows = []
for (const c of contracts ?? []) {
  const baselineS = c.corridor?.baseline_duration_s ?? null
  const threshold = Number(c.trigger_condition?.threshold)
  if (!baselineS || !Number.isFinite(threshold)) {
    rows.push({ id: c.id, title: c.title, totalDays: 0, breachDays: 0, raw: null, tuned: null, note: 'no baseline' })
    continue
  }
  const { totalDays, breachDays } = await breachStats(c.id, baselineS, threshold)
  const raw = totalDays > 0 ? breachDays / totalDays : null
  const tuned = raw === null ? null : Math.min(P_MAX, Math.max(P_MIN, raw))
  rows.push({ id: c.id, title: c.title, totalDays, breachDays, raw, tuned, note: '' })
}

rows.sort((a, b) => b.totalDays - a.totalDays)
console.log('\n  contract                                  days  breach   raw      -> tuned p   confidence')
console.log('  ' + '-'.repeat(92))
for (const r of rows) {
  const conf = r.note || (r.totalDays >= 30 ? 'high' : r.totalDays >= MIN_DAYS ? 'med' : r.totalDays > 0 ? 'low' : 'NONE')
  const title = (r.title ?? '(untitled)').slice(0, 38).padEnd(38)
  const raw = r.raw === null ? '   n/a' : r.raw.toFixed(4)
  const tuned = r.tuned === null ? '  (keep)' : r.tuned.toFixed(4)
  console.log(`  ${title} ${String(r.totalDays).padStart(4)} ${String(r.breachDays).padStart(6)}   ${raw}   -> ${tuned}    ${conf}`)
}
console.log('')

if (APPLY) {
  let updated = 0, skipped = 0
  for (const r of rows) {
    if (r.tuned === null || r.totalDays < MIN_DAYS) { skipped++; continue }
    const { error } = await db.from('coverage_tiers').update({ base_probability: r.tuned }).eq('contract_id', r.id)
    if (error) { console.error(`  FAIL ${r.title}: ${error.message}`); continue }
    updated++
    console.log(`  applied base_probability=${r.tuned.toFixed(4)} -> ${r.title}`)
  }
  console.log(`\n  Done. Updated ${updated}; skipped ${skipped} (no baseline / <${MIN_DAYS} days).`)
} else {
  console.log(`  (dry run — re-run with --apply; needs a corridor baseline + >=${MIN_DAYS} days of readings)\n`)
}
