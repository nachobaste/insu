# Traffic Oracle — Google Maps Integration Design

**Date:** 2026-05-26
**Status:** Approved

## Background

The current Waze fetcher in `lib/oracle/fetcher.ts` is a stub that always returns `traffic_index: 0`. Waze has no public API and will not have one. Urban/traffic contracts are seeded in the DB but cannot trigger automatically — they require admin manual override. This design replaces the stub with a real traffic data source and ships 12 predefined corridor contracts for CDMX.

---

## Goals

1. Replace the Waze stub with a real, automated traffic oracle using the Google Maps Routes API
2. Define 12 predefined CDMX corridors (6 roads × morning + evening)
3. Reduce oracle polling to every 10 minutes (from 5) and scope it to active contract windows only
4. Surface live traffic data on the contract detail page to build hedger trust

---

## Data Model

### New table: `corridors`

Seeded at deploy time. Not user-editable.

```sql
CREATE TABLE corridors (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  road          text NOT NULL,
  origin_lat    numeric NOT NULL,
  origin_lng    numeric NOT NULL,
  dest_lat      numeric NOT NULL,
  dest_lng      numeric NOT NULL,
  window_start  time NOT NULL,
  window_end    time NOT NULL,
  created_at    timestamptz DEFAULT now()
);
```

### Changes to `contracts`

- Add `corridor_id uuid REFERENCES corridors(id)` — nullable (only urban contracts have one)
- Existing `location` JSONB retains `city` for display; `origin`/`destination` coordinates live in `corridors`

### Changes to `oracle_readings`

- Add `'google_maps'` to the `source` check constraint
- Remove `'waze'` from the `source` check constraint

### Trigger condition JSONB

Add a `description` field alongside the existing machine-readable fields:

```json
{
  "metric": "traffic_index",
  "operator": "gt",
  "threshold": 50,
  "description": "Travel time at least 50% worse than normal"
}
```

The contract detail page reads `trigger_condition.description` directly for display.

---

## The 12 Corridors

All corridors use threshold `> 50`. The morning direction points toward city centre; the evening direction is reversed. Both windows are 3 hours.

| Slug | Road | Origin → Destination | Window |
|------|------|----------------------|--------|
| `viaducto-am` | Viaducto Miguel Alemán | Constituyentes → Aeropuerto/Zaragoza | 07:00–10:00 |
| `viaducto-pm` | Viaducto Miguel Alemán | Aeropuerto/Zaragoza → Constituyentes | 17:00–20:00 |
| `bicentenario-am` | Circuito Bicentenario | Northern arc → Southern arc | 07:00–10:00 |
| `bicentenario-pm` | Circuito Bicentenario | Southern arc → Northern arc | 17:00–20:00 |
| `periferico-norte-am` | Periférico Norte | Cuatro Caminos → Constituyentes | 07:00–10:00 |
| `periferico-norte-pm` | Periférico Norte | Constituyentes → Cuatro Caminos | 17:00–20:00 |
| `periferico-sur-am` | Periférico Sur | Estadio Azteca → Insurgentes Sur | 07:00–10:00 |
| `periferico-sur-pm` | Periférico Sur | Insurgentes Sur → Estadio Azteca | 17:00–20:00 |
| `reforma-am` | Paseo de la Reforma | Observatorio → Alameda Central | 07:00–10:00 |
| `reforma-pm` | Paseo de la Reforma | Alameda Central → Observatorio | 17:00–20:00 |
| `palmas-am` | Av. de las Palmas | Bosques de las Lomas → Fuente de Petróleos | 07:00–10:00 |
| `palmas-pm` | Av. de las Palmas | Fuente de Petróleos → Bosques de las Lomas | 17:00–20:00 |

Exact coordinates for each origin/destination are resolved during implementation via the Google Maps Geocoding API and hardcoded into the seed migration.

**Threshold note:** `> 50` is intentionally set low for early product validation — hedgers should experience payouts. Adjust per corridor once 30 days of real data exists.

---

## Oracle Fetcher

### Replacing `fetchWazeReading`

Delete `fetchWazeReading` and its test. Replace with:

```ts
export async function fetchGoogleMapsReading(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  apiKey: string,
): Promise<FetchedReading>
```

**API call:** `POST https://routes.googleapis.com/directions/v2:computeRoutes`

```json
{
  "origin": { "location": { "latLng": { "latitude": originLat, "longitude": originLng } } },
  "destination": { "location": { "latLng": { "latitude": destLat, "longitude": destLng } } },
  "travelMode": "DRIVE",
  "routingPreference": "TRAFFIC_AWARE",
  "departureTime": "now",
  "extraComputations": ["TRAFFIC_ON_POLYLINE"]
}
```

**Traffic index formula:**

```
traffic_index = clamp(round((duration_in_traffic_seconds / duration_seconds - 1) × 100), 0, 100)
```

Examples:
- Normal conditions: `traffic_index = 0`
- 50% delay (20 min trip takes 30 min): `traffic_index = 50` → **trigger fires**
- Doubled travel time: `traffic_index = 100`

**Output:**

```ts
{
  source: 'google_maps',
  reading_type: 'traffic',
  value: { traffic_index: N, duration_s: N, duration_in_traffic_s: N }
}
```

---

## Poll Orchestrator

### Changes to `lib/oracle/poll.ts`

Add a window guard before fetching. For each active urban contract:

```
if now() (in Mexico City timezone) is NOT within corridor.window_start–window_end:
  skip — no reading written, no API call
else:
  fetch → evaluate trigger → write oracle_reading
```

The cron fires every 10 minutes at all hours. Google is only called during the two active windows (07:00–10:00, 17:00–20:00 Mexico City time). Each contract has exactly one window, so: 6 AM contracts × 18 reads + 6 PM contracts × 18 reads = 216 requests/day × 30 days = **6,480 requests/month** — well within the $200 Google credit (covers ~20,000 requests at $10/1,000).

### Cron update

`vercel.json` cron changes from `0 0 * * *` (daily) to `*/10 * * * *` (every 10 minutes).

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Google API error or timeout | Log error, skip writing a reading for this interval, continue polling other contracts |
| 3+ consecutive failures for one contract | Admin Oracle Monitor flags contract as `STALE` (existing badge logic) |
| Poll fires outside active window | Silent skip — no log entry, no reading written |
| Corridor has no origin/dest coordinates | Throw at startup — seed data must be complete |

No trigger evaluation occurs on missing readings. Contracts stay unresolved rather than falsely settled.

---

## Environment Variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `GOOGLE_MAPS_API_KEY` | Server-only | Routes API — oracle polling |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Client-exposed | Maps JavaScript API — corridor map embed. Restricted to app domain. |

Both use the same Google Cloud project. Two separate keys with different restriction settings is best practice.

---

## Contract Detail Page — Dashboard Components

Both components appear on `app/contracts/[slug]/page.tsx`, stacked above the buy panel. Visible to all visitors (not just buyers) — live data doubles as a conversion tool.

### Component B: Traffic Pulse Bar

Server component. Reads the last 6 `oracle_readings` for the contract's corridor from Supabase on render. No extra API calls.

**Renders:**
- Horizontal bar (0–100 scale) with needle at current `traffic_index`
- Vertical threshold marker at 50
- Color fill: green (< 30), yellow (30–50), red (> 50)
- `TRIGGER ACTIVE` badge when index > 50
- Mini sparkline of last 6 readings (SVG, following existing OracleMonitor bar chart pattern)
- "Updated N min ago" from `read_at` of latest reading
- Outside active window: "Next window opens at HH:MM" with last value greyed out

Auto-refreshes via `router.refresh()` on a 10-minute client-side timer — stays in sync with the oracle cron.

### Component C: Corridor Map

Client component using `@googlemaps/js-api-loader` (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`).

**On mount:**
1. Centers map on corridor midpoint (derived from origin + destination coordinates)
2. Enables `google.maps.TrafficLayer()` — Google's real-time traffic color overlay, no extra cost
3. Draws a highlighted polyline from `origin` to `destination` so the user's corridor stands out

**Map config:**
- Compact height (not full-screen)
- `gestureHandling: 'none'` — non-interactive by default, keeps focus on the contract
- Small "Open in Google Maps" external link for commuters wanting navigation

---

## Testing

Follows the existing TDD pattern in `tests/lib/oracle/`.

| Test file | Coverage |
|-----------|----------|
| `fetcher.test.ts` | Mocked Google API response → correct `traffic_index` derivation; API error → throws; update removes Waze stub test |
| `poll.test.ts` | Out-of-window contract → skipped (no reading written); in-window → reading written and trigger evaluated |
| `trigger.test.ts` | No changes needed — existing `gt` operator coverage is sufficient |
| Integration | Mocked Google API response drives full poll → reading → trigger → payout chain for one corridor contract |

The `fetchWazeReading` function and its test are deleted entirely.

---

## Files Changed

| File | Change |
|------|--------|
| `lib/oracle/fetcher.ts` | Delete `fetchWazeReading`, add `fetchGoogleMapsReading` |
| `lib/oracle/poll.ts` | Add corridor join + window guard |
| `supabase/migrations/YYYYMMDD_corridors.sql` | Create `corridors` table, add `corridor_id` to contracts, update source enum |
| `supabase/migrations/YYYYMMDD_seed_corridors.sql` | Seed 12 corridors with geocoded coordinates |
| `supabase/migrations/YYYYMMDD_seed_traffic_contracts.sql` | Seed 12 urban contracts referencing corridors |
| `vercel.json` | Cron `*/10 * * * *` |
| `app/contracts/[slug]/page.tsx` | Add TrafficPulseBar + CorridorMap components |
| `components/contracts/TrafficPulseBar.tsx` | New server component |
| `components/contracts/CorridorMap.tsx` | New client component |
| `tests/lib/oracle/fetcher.test.ts` | Remove Waze stub test, add Google Maps tests |
| `tests/lib/oracle/poll.test.ts` | Add window guard tests |
| `.env.local` / Vercel env | Add two Google Maps API keys |
