// scripts/tomtom-crosscheck-report.mjs
// Read-only summary of the TomTom cross-check spike. Loads .env.local, reads the
// tomtom_crosscheck table, and reports per-corridor coverage, Google-vs-TomTom
// index agreement, live-vs-historic spread, and incident hit-rate.
//   node scripts/tomtom-crosscheck-report.mjs [days]   (default 7)
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

const days = Number(process.argv[2] ?? 7)
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
const db = createClient(url, key, { auth: { persistSession: false } })

const { data: corridors } = await db.from('corridors').select('id, slug')
const slugById = new Map((corridors ?? []).map((c) => [c.id, c.slug]))

const PAGE = 1000
const rows = []
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from('tomtom_crosscheck')
    .select('*')
    .gte('captured_at', since)
    .order('captured_at', { ascending: true })
    .range(from, from + PAGE - 1)
  if (error) throw error
  if (!data || data.length === 0) break
  rows.push(...data)
  if (data.length < PAGE) break
}

console.log(`=== TOMTOM CROSS-CHECK (last ${days}d) ===  rows: ${rows.length}  now: ${new Date().toISOString()}`)
if (rows.length === 0) { console.log('no rows captured yet'); process.exit(0) }

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (s.length === 0) return null
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const byCorridor = new Map()
for (const r of rows) {
  const slug = slugById.get(r.corridor_id) ?? r.corridor_id
  if (!byCorridor.has(slug)) byCorridor.set(slug, [])
  byCorridor.get(slug).push(r)
}

console.log('\n  corridor                     n   ttCov%  incident%  medTTidxHist  medGoogleIdx  medAbsDiff  medDelayS')
console.log('  ' + '-'.repeat(104))
for (const [slug, rs] of [...byCorridor.entries()].sort()) {
  const n = rs.length
  const cov = rs.filter((r) => r.tomtom_covered).length / n
  const inc = rs.filter((r) => (r.tt_incident_count ?? 0) > 0).length / n
  const medTT = median(rs.map((r) => Number(r.tt_index_vs_historic)))
  const paired = rs.filter((r) => r.google_traffic_index != null && r.tt_index_vs_historic != null)
  const medG = median(paired.map((r) => Number(r.google_traffic_index)))
  const medDiff = median(paired.map((r) => Math.abs(Number(r.google_traffic_index) - Number(r.tt_index_vs_historic))))
  const medDelay = median(rs.map((r) => Number(r.tt_delay_s)))
  const f = (x, d = 2) => (x == null ? '  n/a' : x.toFixed(d))
  console.log(`  ${slug.slice(0, 26).padEnd(26)} ${String(n).padStart(4)}  ${(cov * 100).toFixed(0).padStart(5)}  ${(inc * 100).toFixed(0).padStart(8)}  ${f(medTT).padStart(11)}  ${f(medG).padStart(11)}  ${f(medDiff).padStart(9)}  ${f(medDelay, 0).padStart(8)}`)
}

// GT vs CDMX coverage roll-up — the key thin-coverage question.
for (const [label, pred] of [['CDMX', (s) => !s.startsWith('gt-')], ['GT', (s) => s.startsWith('gt-')]]) {
  const rs = rows.filter((r) => pred(slugById.get(r.corridor_id) ?? ''))
  if (rs.length === 0) continue
  const cov = rs.filter((r) => r.tomtom_covered).length / rs.length
  const diff = rs.filter((r) => r.tomtom_covered && r.tt_live_s != null && r.tt_historic_s != null && r.tt_live_s !== r.tt_historic_s).length / rs.length
  console.log(`\n  ${label}: n=${rs.length}  tomtom_covered=${(cov * 100).toFixed(0)}%  live≠historic=${(diff * 100).toFixed(0)}% (traffic differentiation present)`)
}
