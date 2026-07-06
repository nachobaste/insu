// scripts/compute-corridor-baselines.mjs
// Read-only analysis: per corridor, median WEEKDAY in-window trip duration from
// oracle_readings.value.duration_s. Pass --apply to UPDATE corridors.baseline_duration_s.
// Canonical metric formula lives in lib/oracle/trafficIndex.ts; this script only
// needs the median of duration_s, so no index math here.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = { ...process.env }
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env.local — rely on process.env */ }
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Aborting.')
  process.exit(2)
}

const APPLY = process.argv.includes('--apply')
const MIN_READINGS = 20      // need a reasonable sample before trusting a median
const MIN_WEEKDAYS = 5       // spread across at least 5 distinct weekdays
const db = createClient(url, key, { auth: { persistSession: false } })

function median(nums) {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}
const isWeekday = (d) => { const g = d.getUTCDay(); return g >= 1 && g <= 5 }

// Corridors and the contract(s) that reference them.
const { data: corridors, error: cErr } = await db
  .from('corridors').select('id, slug, name')
if (cErr) throw cErr
const { data: contracts, error: ctErr } = await db
  .from('contracts').select('id, corridor_id').eq('trigger_type', 'urban')
if (ctErr) throw ctErr
const contractsByCorridor = new Map()
for (const c of contracts ?? []) {
  if (!c.corridor_id) continue
  const arr = contractsByCorridor.get(c.corridor_id) ?? []
  arr.push(c.id); contractsByCorridor.set(c.corridor_id, arr)
}

const PAGE = 1000
async function durations(contractIds) {
  const out = [] // { durationS, day, weekday }
  for (const cid of contractIds) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('oracle_readings')
        .select('read_at, value')
        .eq('contract_id', cid)
        .order('read_at', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      for (const r of data) {
        const dur = Number(r.value?.duration_s)
        if (!Number.isFinite(dur) || dur <= 0) continue
        const d = new Date(r.read_at)
        out.push({ durationS: dur, day: d.toISOString().slice(0, 10), weekday: isWeekday(d) })
      }
      if (data.length < PAGE) break
    }
  }
  return out
}

const rows = []
for (const corr of corridors ?? []) {
  const ids = contractsByCorridor.get(corr.id) ?? []
  const all = ids.length ? await durations(ids) : []
  const weekday = all.filter((r) => r.weekday)
  const distinctWeekdays = new Set(weekday.map((r) => r.day)).size
  const med = median(weekday.map((r) => r.durationS))
  rows.push({ slug: corr.slug, name: corr.name, id: corr.id, n: weekday.length, distinctWeekdays, median: med })
}

rows.sort((a, b) => b.n - a.n)
console.log('\n  corridor                                  n(wd)  days   median_s   confidence')
console.log('  ' + '-'.repeat(74))
for (const r of rows) {
  const conf = r.n >= MIN_READINGS && r.distinctWeekdays >= MIN_WEEKDAYS ? 'ok' : r.n > 0 ? 'low' : 'NONE'
  const name = (r.name ?? r.slug).slice(0, 38).padEnd(38)
  const med = r.median === null ? '   n/a' : String(r.median).padStart(8)
  console.log(`  ${name} ${String(r.n).padStart(5)} ${String(r.distinctWeekdays).padStart(5)}   ${med}    ${conf}`)
}
console.log('')

if (APPLY) {
  let updated = 0, skipped = 0
  for (const r of rows) {
    if (r.median === null || r.n < MIN_READINGS || r.distinctWeekdays < MIN_WEEKDAYS) { skipped++; continue }
    const { error } = await db.from('corridors').update({ baseline_duration_s: r.median }).eq('id', r.id)
    if (error) { console.error(`  FAIL ${r.slug}: ${error.message}`); continue }
    updated++
    console.log(`  applied baseline_duration_s=${r.median} -> ${r.slug}`)
  }
  console.log(`\n  Done. Updated ${updated}; skipped ${skipped} (insufficient history -> kept free-flow fallback).`)
} else {
  console.log(`  (dry run — re-run with --apply to write; needs >=${MIN_READINGS} weekday readings across >=${MIN_WEEKDAYS} days)\n`)
}
