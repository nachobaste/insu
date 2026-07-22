# TomTom Read-Only Cross-Check Spike — Design

**Date:** 2026-07-21
**Status:** Approved (design)
**Type:** Spike / de-risking (no production behavior change)

## Purpose

Evaluate whether TomTom's traffic data can make our urban-traffic oracle more
robust and our pricing engine smarter — **without touching any production
behavior**. The spike shadows our live Google-based traffic oracle: for every
active urban corridor, it captures TomTom's routing and incident data alongside
the Google reading we already store, so we can compare them offline.

It answers three questions with real data before we commit to any change:

1. **Coverage** — does TomTom return usable routing + incident data for our
   corridors, especially in **Guatemala City** (the thin-coverage unknown)?
2. **Second-source agreement** — how closely does a TomTom-derived traffic
   index track our Google-derived `traffic_index`? (robustness / dispute
   resistance / anomaly rejection)
3. **Live-vs-historic** — TomTom returns a time-of-day `historicTravelTime` in
   the same live call; does `live/historic` look like a viable self-consistent
   baseline that could replace our separately-calibrated
   `corridors.baseline_duration_s`?

Incident capture additionally validates TomTom's Incident Details coverage (the
input to a future "insure the actual cause" / trigger-confirmation improvement).

## Non-Goals (explicit YAGNI / safety boundary)

- **No** writes to `oracle_readings`.
- **No** trigger evaluation, no payouts.
- **No** change to pricing, `base_probability`, `oracleMultiplier`, or reprice.
- **No** UI.
- **No** replacement of the Google oracle. This spike only observes and records.

The spike is architected so it is *physically incapable* of moving a price or
firing a trigger: it writes only to a dedicated `tomtom_crosscheck` table that
nothing in the live trigger/pricing/`dailySeries` pipeline reads.

## Architecture

Fully separate shadow path parallel to the live poll (`lib/oracle/poll.ts` →
`/api/oracle-poll`). Chosen over piggybacking on `pollContracts` because a
separate table + endpoint cannot leak spike data into the production pipeline.

```
cron-job.org (15-min window cadence)
        │  GET, cron-authed
        ▼
/api/tomtom-crosscheck ──► runTomTomCrossCheck(db, fetchers)
                                  │  for each ACTIVE urban corridor IN WINDOW:
                                  │    1. fetchTomTomRoute(origin→dest)
                                  │    2. fetchTomTomIncidents(corridor bbox)
                                  │    3. read latest matching Google oracle_readings row
                                  │    4. INSERT one tomtom_crosscheck row
                                  ▼
                          tomtom_crosscheck (isolated table)
                                  ▲
                                  │  read-only
                    scripts/tomtom-crosscheck-report.mjs  ("read the spike")
```

### Components (all new)

- **`lib/oracle/tomtomFetcher.ts`** — pure fetch + normalize functions, no DB:
  - `fetchTomTomRoute(originLat, originLng, destLat, destLng, apiKey)` →
    `{ liveS, freeFlowS, historicS, delayS, indexVsHistoric, indexVsFreeFlow, covered, raw }`.
    Uses TomTom Routing `calculateRoute` with `computeTravelTimeFor=all`, reading
    `travelTimeInSeconds` (live), `noTrafficTravelTimeInSeconds` (free-flow),
    `historicTrafficTravelTimeInSeconds` (typical for time-of-day), and
    `trafficDelayInSeconds`. `covered=false` when no route is returned.
    Index math reuses the canonical `trafficIndex(durationS, baselineS)` formula
    from `lib/oracle/trafficIndex.ts` (index vs historic AND vs free-flow).
  - `fetchTomTomIncidents(bbox, apiKey)` →
    `{ count, byCategory, maxMagnitude, raw }`. Uses Traffic Incidents Incident
    Details over the corridor bounding box; `byCategory` counts
    `iconCategory` (Accident, Jam, RoadClosed, RoadWorks, Flooding, …),
    `maxMagnitude` = max `magnitudeOfDelay` (0–4).
- **`lib/oracle/crosscheck.ts`** — `runTomTomCrossCheck(db, fetchers)`
  orchestration, dependency-injectable exactly like `pollContracts` for testing.
  Selects active urban contracts + corridors, applies the same
  `isWithinWindow` gate as the live poll, snapshots the latest Google
  `oracle_readings` row for the corridor's contract (no extra Google spend),
  writes one `tomtom_crosscheck` row per corridor. Per-corridor try/catch so one
  failure never aborts the batch (mirrors `poll.ts`).
- **`app/api/tomtom-crosscheck/route.ts`** — cron-authed thin wrapper
  (`validateCronRequest`), `GET` + `POST`, returns `{ captured: N }`.
- **`scripts/tomtom-crosscheck-report.mjs`** — read-only analysis script mirroring
  `.oracle-check.mjs` (loads `.env.local`, service-role client). Reports:
  per-corridor coverage rate (**CDMX vs GT**), TomTom-covered %,
  Google-index-vs-TomTom-index divergence (mean/median abs diff, correlation),
  live-vs-historic index distribution, incident hit-rate + category breakdown.

### New table: `tomtom_crosscheck`

Migration `supabase/migrations/<ts>_tomtom_crosscheck.sql`, `gen_random_uuid()`
default (per the prod push-search-path gotcha).

| column | type | notes |
|---|---|---|
| `id` | uuid pk | `default gen_random_uuid()` |
| `corridor_id` | uuid | FK `corridors(id)` |
| `captured_at` | timestamptz | `default now()` |
| `in_window` | boolean | always true given the gate; kept for forensic clarity |
| `tomtom_covered` | boolean | did TomTom return a route (GT coverage signal) |
| `tt_live_s` | int | |
| `tt_free_flow_s` | int | `noTrafficTravelTimeInSeconds` |
| `tt_historic_s` | int | `historicTrafficTravelTimeInSeconds` |
| `tt_delay_s` | int | `trafficDelayInSeconds` |
| `tt_index_vs_historic` | numeric | `trafficIndex(live, historic)` |
| `tt_index_vs_free_flow` | numeric | `trafficIndex(live, freeFlow)` |
| `tt_incident_count` | int | active incidents on corridor bbox |
| `tt_incidents` | jsonb | category → count breakdown |
| `tt_max_magnitude` | int | max `magnitudeOfDelay` (0–4) |
| `google_duration_s` | int | from snapshotted Google reading (nullable) |
| `google_baseline_s` | int | corridor baseline used by the Google reading |
| `google_traffic_index` | numeric | Google-derived index (nullable) |
| `google_reading_at` | timestamptz | when the snapshotted Google reading was taken |
| `raw` | jsonb | full TomTom route + incidents payloads (forensic) |

No RLS policy needed for reads (service-role only writes/reads; not user-facing).
Follow the repo's existing migration style for grants.

## Data Flow & Coverage Handling

For each active urban corridor in window:
1. `fetchTomTomRoute` — on no-route, record `tomtom_covered=false` with null TT
   times (so the report can quantify coverage gaps rather than silently skip).
2. `fetchTomTomIncidents` — on failure, leave incident fields null; route row
   still written.
3. Read latest `oracle_readings` (source `google_maps`) for the corridor's
   contract; snapshot `duration_s`, `baseline_duration_s`, `traffic_index`,
   `read_at`. If none within a sane lookback (e.g. last 30 min), leave Google
   fields null (the live poll may have skipped that cycle).
4. Insert one `tomtom_crosscheck` row.

Time skew between the TomTom call and the snapshotted Google reading is bounded
by the shared 15-min cadence and is acceptable for a comparison spike.

## Testing (TDD)

- **`tomtomFetcher`** — unit tests mapping representative TomTom JSON (route with
  `computeTravelTimeFor=all`; incidents payload; a no-route/empty response) to
  normalized fields; index math and incident categorization. No live network.
- **`crosscheck`** — orchestration tests with injected fake fetchers + fake db
  (mirroring the existing `pollContracts` tests): window gating, coverage-gap
  row written, Google snapshot join, per-corridor error isolation.
- No test hits the live TomTom or Google APIs.

## Cost / Cadence

~16 corridors, window-gated, 15-min cadence ⇒ 2 TomTom calls/corridor/cycle
(route + incidents), same order of magnitude as the existing Google poll.
Confirm the TomTom account's daily request quota covers this before enabling the
cron; the report tolerates gaps, so a conservative cadence is fine to start.

## Rollout

1. Add `TOMTOM_API_KEY` to Vercel env (and `.env.local`).
2. Apply migration: `supabase db push --linked < /dev/null`.
3. Deploy; manually hit `/api/tomtom-crosscheck` once (cron-authed) to smoke it.
4. Create a cron-job.org job at the window cadence (parallel to the traffic poll).
5. Run ~1 week; then `node scripts/tomtom-crosscheck-report.mjs`.
6. Decide on improvements #1–#4 from the analysis using the captured evidence.

## Success Criteria

- ≥1 week of `tomtom_crosscheck` rows across CDMX + GT corridors.
- Report quantifies: TomTom coverage % per corridor (esp. GT), Google-vs-TomTom
  index agreement, live-vs-historic viability, incident hit-rate.
- Zero impact on production: no `oracle_readings` writes, no triggers, no price
  changes attributable to the spike.
