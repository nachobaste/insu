// scripts/calibrate-corridors.mjs
// Credibility-weighted corridor calibration:
//   baselines:      blend harvested weekday median with Google predicted median
//   probabilities:  Beta-Binomial blend of a lognormal model prior (from the
//                   Google PESSIMISTIC/OPTIMISTIC envelope, global z fitted to
//                   our measured corridors) with observed breach frequency.
// Dry-run by default. Writes only with --apply-baselines / --apply-probabilities.
// Predictions come from GET /api/calibrate (server-side Routes API key); skip
// them entirely with --no-predict (degrades to harvested-only behavior).
//
// Usage:
//   node scripts/calibrate-corridors.mjs
//   node scripts/calibrate-corridors.mjs --apply-baselines
//   node scripts/calibrate-corridors.mjs --apply-baselines --apply-probabilities
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  median, blendBaseline, sigmaFromEnvelope, breachProbability, betaBlend, fitZ,
} from './lib/calibration-math.mjs'

const env = { ...process.env }
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* rely on process.env */ }

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
const cronSecret = env.CRON_SECRET
const baseUrl = env.CALIBRATE_BASE_URL ?? 'https://insu-theta.vercel.app'
if (!url || !key) { console.error('Missing Supabase creds. Aborting.'); process.exit(2) }

const APPLY_BASELINES = process.argv.includes('--apply-baselines')
const APPLY_PROBABILITIES = process.argv.includes('--apply-probabilities')
const NO_PREDICT = process.argv.includes('--no-predict')

// Tuning constants — documented in docs/superpowers/plans/2026-07-09-credibility-weighted-calibration.md
const BASELINE_K = 10   // weekday-days at which harvested and predicted weigh 50/50
const M_PRIOR = 20      // pseudo-days of prior strength for base_probability
const MIN_DAYS = 7      // reading-days required to participate in the z fit
const P_MIN = 0.0005, P_MAX = 0.95
const TRAFFIC_INDEX_MAX = 100 // keep in sync with lib/oracle/trafficIndex.ts

const db = createClient(url, key, { auth: { persistSession: false } })

// Canonical traffic-index formula (mirror of lib/oracle/trafficIndex.ts).
function trafficIndex(durationS, baselineS) {
  if (!baselineS || baselineS <= 0) return 0
  const raw = ((durationS / baselineS) - 1) * 100
  return Math.min(TRAFFIC_INDEX_MAX, Math.max(0, Math.round(raw)))
}

const isWeekday = (d) => { const g = d.getUTCDay(); return g >= 1 && g <= 5 }
const PAGE = 1000

async function readingsFor(contractIds) {
  const out = [] // { durationS, day, weekday }
  for (const cid of contractIds) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('oracle_readings').select('read_at, value')
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

async function fetchPrediction(slug) {
  if (NO_PREDICT) return null
  if (!cronSecret) { console.error('  (no CRON_SECRET in env — skipping predictions)'); return null }
  try {
    const res = await fetch(`${baseUrl}/api/calibrate?corridor=${encodeURIComponent(slug)}`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    })
    if (!res.ok) {
      console.error(`  predict ${slug}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`)
      return null
    }
    return await res.json()
  } catch (e) {
    console.error(`  predict ${slug}: ${e.message}`)
    return null
  }
}

// ---- load corridors, urban contracts, and their readings --------------------
const { data: corridors, error: corrErr } = await db
  .from('corridors').select('id, slug, name, baseline_duration_s')
if (corrErr) throw corrErr
const { data: contracts, error: ctErr } = await db
  .from('contracts')
  .select('id, title, corridor_id, trigger_condition')
  .eq('trigger_type', 'urban')
if (ctErr) throw ctErr

const contractsByCorridor = new Map()
for (const c of contracts ?? []) {
  if (!c.corridor_id) continue
  contractsByCorridor.set(c.corridor_id, [...(contractsByCorridor.get(c.corridor_id) ?? []), c])
}

// ---- per corridor: harvested stats + prediction + blended baseline ----------
const rows = []
for (const corr of corridors ?? []) {
  const corrContracts = contractsByCorridor.get(corr.id) ?? []
  if (corrContracts.length === 0) continue

  const readings = await readingsFor(corrContracts.map((c) => c.id))
  const weekday = readings.filter((r) => r.weekday)
  const harvestedWeekdayDays = new Set(weekday.map((r) => r.day)).size
  const harvestedMedianS = median(weekday.map((r) => r.durationS))

  process.stdout.write(`  sampling ${corr.slug} …\n`)
  const prediction = await fetchPrediction(corr.slug)
  const predictedMedianS = prediction?.predictedMedianS ?? null
  const envOpt = prediction ? median(prediction.envelope.map((e) => e.optS)) : null
  const envPess = prediction ? median(prediction.envelope.map((e) => e.pessS)) : null
  const envBest = prediction ? median(prediction.envelope.map((e) => e.bestS)) : null

  const { baselineS, source } = blendBaseline({
    harvestedMedianS, harvestedWeekdayDays, predictedMedianS, k: BASELINE_K,
  })

  // Breach stats against the PROPOSED baseline (the baseline defines a breach).
  const threshold = Number(corrContracts[0]?.trigger_condition?.threshold)
  const allDays = new Set(), breachDaysSet = new Set()
  if (baselineS && Number.isFinite(threshold)) {
    for (const r of readings) {
      allDays.add(r.day)
      if (trafficIndex(r.durationS, baselineS) > threshold) breachDaysSet.add(r.day)
    }
  }

  rows.push({
    corridor: corr, contracts: corrContracts,
    harvestedMedianS, harvestedWeekdayDays, predictedMedianS,
    baselineS, source, thresholdPct: threshold,
    optS: envOpt, pessS: envPess, bestS: envBest,
    totalDays: allDays.size, breachDays: breachDaysSet.size,
  })
}

// ---- global z fit ------------------------------------------------------------
const { z, pooledMeasured, pooledModel } = fitZ(rows, { minDays: MIN_DAYS })
console.log(`\n  z fit: z=${z ?? 'n/a'}  pooled measured=${pooledMeasured?.toFixed(4) ?? 'n/a'}  pooled model=${pooledModel?.toFixed(4) ?? 'n/a'}`)

// ---- report -------------------------------------------------------------------
console.log('\n  corridor                     harvested(n)  predicted  -> baseline (source)   days breach  pModel  pPost')
console.log('  ' + '-'.repeat(112))
for (const r of rows) {
  const sigma = z != null ? sigmaFromEnvelope(r.optS, r.pessS, z) : null
  r.pModel = sigma != null && r.bestS
    ? breachProbability({ baselineS: r.baselineS, thresholdPct: r.thresholdPct, muLog: Math.log(r.bestS), sigma })
    : null
  const rawPost = betaBlend({ pModel: r.pModel, priorDays: M_PRIOR, breachDays: r.breachDays, totalDays: r.totalDays })
  r.pPost = rawPost === null ? null : Math.min(P_MAX, Math.max(P_MIN, rawPost))

  const slug = r.corridor.slug.slice(0, 26).padEnd(26)
  const harv = r.harvestedMedianS ? `${r.harvestedMedianS}s(${r.harvestedWeekdayDays}d)` : 'none'
  const pred = r.predictedMedianS ? `${r.predictedMedianS}s` : 'none'
  const base = r.baselineS ? `${r.baselineS}s (${r.source})` : 'NULL'
  const pm = r.pModel != null ? r.pModel.toFixed(4) : '  n/a'
  const pp = r.pPost != null ? r.pPost.toFixed(4) : '  n/a'
  console.log(`  ${slug} ${harv.padStart(13)} ${pred.padStart(9)}  -> ${base.padEnd(20)} ${String(r.totalDays).padStart(4)} ${String(r.breachDays).padStart(6)}  ${pm}  ${pp}`)

  // Validation gate: flag corridors where model and measurement disagree badly.
  if (r.pModel != null && r.totalDays >= MIN_DAYS) {
    const measured = r.breachDays / r.totalDays
    if (measured > 0 && (r.pModel / measured > 3 || measured / r.pModel > 3)) {
      console.log(`    ⚠ model/measured disagree >3x (measured=${measured.toFixed(4)}) — inspect before applying`)
    }
  }
}

// ---- apply --------------------------------------------------------------------
if (APPLY_BASELINES) {
  console.log('')
  for (const r of rows) {
    if (!r.baselineS) { console.log(`  skip baseline ${r.corridor.slug}: no value`); continue }
    const { error } = await db.from('corridors')
      .update({ baseline_duration_s: r.baselineS, baseline_source: r.source })
      .eq('id', r.corridor.id)
    if (error) console.error(`  FAIL baseline ${r.corridor.slug}: ${error.message}`)
    else console.log(`  applied baseline ${r.baselineS}s (${r.source}) -> ${r.corridor.slug}`)
  }
}
if (APPLY_PROBABILITIES) {
  console.log('')
  for (const r of rows) {
    if (r.pPost == null) { console.log(`  skip probability ${r.corridor.slug}: no posterior`); continue }
    for (const c of r.contracts) {
      const { error } = await db.from('coverage_tiers')
        .update({ base_probability: r.pPost })
        .eq('contract_id', c.id)
      if (error) console.error(`  FAIL probability ${c.title}: ${error.message}`)
      else console.log(`  applied base_probability=${r.pPost.toFixed(4)} -> ${c.title}`)
    }
  }
}
if (!APPLY_BASELINES && !APPLY_PROBABILITIES) {
  console.log('\n  (dry run — nothing written; use --apply-baselines and/or --apply-probabilities)\n')
}
