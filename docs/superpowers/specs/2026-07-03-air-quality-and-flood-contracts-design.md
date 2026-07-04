# Air Quality & Flood Parametric Contracts — Design

- **Date:** 2026-07-03
- **Status:** Approved (design) — pending implementation plan
- **Author:** Gerardo + Claude

## Motivation

Insu's parametric book currently covers traffic (urban corridors), weather, and
fuel. We are expanding into two new hazard domains that clear the "uncontestable
oracle" bar and have real, under-served markets in CDMX:

- **Urban air quality** — payout when pollution crosses a threshold (the
  contingencia-ambiental experience). Novel; no incumbent product.
- **Urban flooding** — payout when rain-driven flash flooding is likely at the
  covered location.

### Why these qualify as oracles

Both satisfy the five criteria we use to judge oracle-worthiness:

1. **Neutral** — government/scientific data providers, not insurer or insured.
2. **On-demand & timestamped** — pollable values written to `oracle_readings`.
3. **Reproducible** — each reading is self-contained and archived.
4. **Not gameable** — a buyer cannot cheaply cause a citywide pollution episode
   or a rainstorm at their location.
5. **Right granularity** — point-location readings that correlate with the
   buyer's real exposure (with documented basis risk on flood; see Risks).

## Goals

- Ship two new recurring parametric products, `air_quality` and `flood`.
- Reuse the existing weather-fetcher pattern (point location + external API +
  numeric threshold trigger) and the recurring derivative pricing engine
  **without changing the pricing code**.
- Keep the two oracles as cleanly separated units that share small, pure,
  independently-testable helpers (approach C, below).

## Non-Goals (YAGNI guardrails)

- No multi-hour rainfall **accumulation** trigger (peak intensity only for now).
- No new geo table (point location lives in `contract.location`).
- No pricing-engine changes.
- No non-CDMX SEDEMA support (OWM paths generalize; SEDEMA is CDMX-only).
- No official-contingencia-declaration trigger (numeric threshold only).

## Architecture

### New trigger types

`air_quality` and `flood` are added to the `contracts.trigger_type` enum and to
`POLLABLE_TRIGGER_TYPES` in `lib/oracle/poll.ts`. Both follow the **weather**
pattern, not the **urban/corridor** pattern: they read `contract.location
{lat,lng}` directly and need no `corridors`-style geometry table.

### Data flow (identical for both)

```
GitHub Actions cron (?types=air_quality|flood)
  → POST /api/oracle-poll
    → pollContracts()
      → defaultFetcher() branch  (new)
        → fetch from source(s) + normalize to metric
      → insert oracle_readings { source, reading_type, value, trigger_met }
      → evaluateTrigger(value, contract.trigger_condition)
  → reprice via existing dailyHazard() (metric-agnostic)
```

### Code structure — approach C (separate branches + shared helpers)

Keep the explicit per-type branches the codebase already uses (`weather`,
`urban`, `fuel`), and factor the reusable pieces into small pure functions:

| Unit | Responsibility | Depends on |
|---|---|---|
| `lib/oracle/owmClient.ts` | Thin typed wrapper around OWM GET calls | env key, `fetch` |
| `lib/oracle/airQualityIndex.ts` | Pure: pollutant concentrations → IMECA-scale index (max sub-index over O₃/PM2.5). Accepts SEDEMA and OWM inputs. | none (pure) |
| `lib/oracle/rainfall.ts` | Pure: OWM response → `{ rain_1h_mm, rain_3h_mm }`; absent rain → 0 | none (pure) |
| `defaultFetcher` `air_quality` branch | Orchestrate SEDEMA→OWM fallback, normalize, build reading | above helpers |
| `defaultFetcher` `flood` branch | Fetch OWM precip, parse, build reading | owmClient, rainfall |

The IMECA normalizer is the one genuinely tricky unit and is isolated
specifically so it can be unit-tested exhaustively.

## Component detail

### Air-quality fetcher (`trigger_type: 'air_quality'`)

- Reads `contract.location {lat,lng}`.
- **Primary — SEDEMA/SIMAT:** fetch latest station data, select the nearest
  station to the contract point, read pollutant concentrations (and published
  IMECA where available). `source: 'sedema'`.
- **Fallback — OWM Air Pollution API** at `lat/lng` (raw concentrations in
  µg/m³). `source: 'openweathermap'`. Used when SEDEMA is unreachable/stale.
- **Normalization:** `airQualityIndex()` converts concentrations to the official
  **IMECA scale** using per-pollutant breakpoint tables, taking the **max
  sub-index** across O₃ and PM2.5 (the pollutants that drive CDMX contingencia).
  This is why the trigger metric is an index, not raw PM2.5: CDMX episodes are
  frequently ozone-driven, and a PM2.5-only metric would miss them.

**Reading `value` shape:**
```json
{
  "aqi_imeca": 162,
  "pm25": 41.0,
  "o3": 0.098,
  "station": "MER",
  "source_detail": "sedema"
}
```
Trigger metric: `aqi_imeca`.

### Flood fetcher (`trigger_type: 'flood'`)

- Reads `contract.location {lat,lng}`.
- **OWM** current/One Call precipitation → `rainfall.ts` parser.
- **Stateless peak-intensity** trigger: each poll records the latest observed
  1h (and 3h, for context) precipitation. No cross-poll accumulation state, so a
  missed poll cannot corrupt a running total — better on the reproducibility
  criterion and simpler. Rationale: CDMX flooding is flash/pluvial, driven by
  short high-intensity convective bursts, not multi-day accumulation.
- Absent OWM `rain` field → `0` (no rain reported).

**Reading `value` shape:**
```json
{ "rain_1h_mm": 34.2, "rain_3h_mm": 51.0 }
```
Trigger metric: `rain_1h_mm`.

## Trigger schema & defaults

No change to `TriggerCondition` (`{ metric, threshold, operator }`) or
`evaluateTrigger`. Default starting conditions (per-contract tunable):

- `air_quality` → `{ metric: "aqi_imeca", operator: "gte", threshold: 150 }`
  (Fase I contingencia level).
- `flood` → `{ metric: "rain_1h_mm", operator: "gte", threshold: 30 }`
  (intense hourly rainfall).

Thresholds are set per contract via a new admin form field (see below) — not
hardcoded — because the right line varies by location (drainage) and pollutant.

## Pricing

**No code changes.** `computeOracleMultiplier` is metric-agnostic
(`proximity = actual / threshold`, clamped to [0.3, 3.0]) and
`dailyHazard = base_probability × multiplier` (clamped to [P_MIN, P_MAX]). Any
numeric metric prices correctly as long as:

- the reading `value` carries the metric key as a number, and
- each `coverage_tier` has a seeded `base_probability`.

`base_probability` is seeded at contract creation with an estimate and tuned
later from accumulated oracle history — the same known limitation as the traffic
book (thin history early). Tiers use fixed-payout Basic/Pro like traffic.

## Scheduling

Reuse the existing GitHub Actions `?types=` polling mechanism (Vercel Hobby crons
run once/day, insufficient for intraday hazards). Weather/fuel stay on the daily
Vercel cron.

- **Air quality** — hourly during daytime when O₃/PM peak. Schedule
  `types=air_quality`, roughly MX 08:00–21:00 → UTC hours `14-23,0-3`.
- **Flood** — hourly, year-round (storms are not schedulable). `types=flood`.

Both trigger types added to `POLLABLE_TRIGGER_TYPES`. New workflow file(s) modeled
on `.github/workflows/oracle-poll-urban.yml`.

## Database migration (single file)

- Add `air_quality`, `flood` to `contracts_trigger_type_check`.
- **Drop + recreate `oracle_readings_source_check` to add `'sedema'`**
  (`openweathermap` already allowed). Called out explicitly: the missing-source
  entry is exactly what silently broke the fuel oracle previously.
- No new tables or columns.

## Admin / contract creation

Contracts are admin-created via `upsertContract` + `ContractForm` like every
other contract.

- `air_quality` and `flood` appear in the trigger-type dropdown.
- Existing lat/lng location fields supply the point (no corridor editor).
- **New per-contract threshold field** in `ContractForm` feeding
  `trigger_condition.threshold` (IMECA level / rainfall mm), with the metric and
  operator defaulted per trigger type.

## Error handling

- **SEDEMA unreachable/stale** → fall back to OWM; record `source` accordingly so
  provenance is auditable per reading.
- **Both sources fail** → no reading written for that poll (consistent with
  existing fetchers returning `[]`); logged, not fatal.
- **Absent OWM rain field** → `rain_1h_mm = 0`.
- **Invalid/missing metric in `value`** → `evaluateTrigger` returns `false`
  (existing behavior; no spurious payout).

## Testing (TDD)

- **Pure units (exhaustive):**
  - `airQualityIndex()` — IMECA breakpoints per pollutant, O₃-vs-PM2.5 max
    selection, both SEDEMA and OWM input shapes, boundary values around 150.
  - `rainfall.ts` — present vs absent `rain` field, 1h/3h extraction.
- **Fetcher branches (mocked HTTP):**
  - air_quality: SEDEMA success path; SEDEMA-fail → OWM fallback path; `source`
    tagged correctly.
  - flood: OWM parse + reading shape.
- **Trigger/pricing:** already covered generically; add reading-shape fixtures
  for the new metrics to confirm `evaluateTrigger` / `dailyHazard` behavior.

## Risks & open items

- **SEDEMA API/feed availability is unverified.** Spike this first: confirm a
  live, pollable endpoint and its response shape before building the branch. If
  SEDEMA proves unreliable, air quality can launch OWM-only (numeric IMECA
  derived from OWM concentrations) and add SEDEMA later.
- **Flood basis risk.** Rainfall is a proxy — heavy rain does not always equal a
  flood at that exact point. Accepted for launch; revisit with a gauge
  corroboration or accumulation window if payout data shows misses.
- **Threshold & `base_probability` calibration.** Starting values (150 IMECA,
  30 mm, base_probability estimate) need tuning once oracle history accrues —
  same maturation path as traffic.

## Implementation sequencing (for the plan)

1. Spike/verify SEDEMA endpoint (risk-buydown before committing to the primary).
2. Migration (trigger types + `sedema` source).
3. Shared helpers + unit tests (`airQualityIndex`, `rainfall`, `owmClient`).
4. Fetcher branches + `POLLABLE_TRIGGER_TYPES` + fetcher tests.
5. Admin `ContractForm` threshold field + trigger types.
6. GitHub Actions poll schedules.
7. Seed initial contracts (CDMX) with thresholds and `base_probability`.
