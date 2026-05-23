# Oracle Conditions UI — Design Spec

**Date:** 2026-05-22
**Status:** Approved

## Summary

Surface live oracle readings on the contract detail page as a "Current conditions" block in the left column, between the price chart and contract meta. The block adapts its color and messaging based on proximity to the trigger threshold and shows how current conditions are affecting the premium price. It is hidden entirely when no oracle reading exists.

---

## Placement

Left column of `ContractDetailClient`, between `<PriceChart />` and `<ContractMeta />`. Only rendered when a reading is available.

```
Left column layout (with reading):
  Contract title + location
  PriceChart
  OracleConditions   ← NEW
  ContractMeta
```

---

## Block Contents

| Element | Source | Notes |
|---|---|---|
| Section label | Static | "CURRENT CONDITIONS" (uppercase, muted) |
| Source + timestamp | `reading.source` + `reading.read_at` | e.g. "OpenWeatherMap · 14 min ago" |
| Metric value | `reading.value[condition.metric]` | Large, color-coded by state |
| Metric unit | Derived from metric name | e.g. `temp_c` → "°C", `jam_factor` → "" |
| Threshold label | `condition.threshold` + `condition.operator` | e.g. "Triggers at ≥ 35 °C" |
| Proximity bar | `proximity = actual / threshold` (gte/gt) or `threshold / actual` (lte/lt) | Clamped 0–100% for display |
| Proximity label | Percentage + state text | "81% to trigger" or "⚡ Trigger threshold crossed" |
| Price impact line | `(oracleMultiplier - 1) × 100` | "+34% vs baseline" or "−72% vs baseline" |

---

## Three Visual States

### Low (proximity < 60%)
- Metric value: green (`text-insu-green`)
- Bar fill: solid green
- Border: subtle green tint
- Impact label: "Premium discounted" + green percentage

### Elevated (60% ≤ proximity < 100%)
- Metric value: amber (`text-insu-accent`)
- Bar fill: green → amber gradient
- Border: subtle amber tint
- Impact label: "Premium elevated" + amber percentage

### Trigger met (`trigger_met: true` or proximity ≥ 100%)
- Metric value: red
- Bar fill: solid red, 100% width
- Border: red tint
- Proximity label: "⚡ Trigger threshold crossed"
- Impact label: "Premium at maximum" + red percentage (up to +200%)

---

## Price Impact Calculation

```
oracleMultiplier = tier.pricing_inputs?.oracleMultiplier ?? 1.0
impactPct = Math.round((oracleMultiplier - 1) * 100)
```

- `impactPct > 0` → `"+${impactPct}% vs baseline"` (amber or red)
- `impactPct < 0` → `"${impactPct}% vs baseline"` (green, e.g. "−72%")
- `impactPct === 0` → hide the price impact line (multiplier not yet applied or exactly 1.0)

`oracleMultiplier` is read from the first coverage tier's `pricing_inputs` JSONB. All tiers for a contract share the same oracle reading, so any tier's multiplier is representative.

---

## Proximity Display

```
proximity = actual / threshold        (operator: gte | gt)
proximity = threshold / actual        (operator: lte | lt)
displayPct = Math.min(100, Math.round(proximity * 100))
```

Bar fills to `displayPct`%. If `trigger_met` is true, bar is always 100% and label reads "⚡ Trigger threshold crossed".

---

## Metric Label Formatting

Map known metric names to display labels for the unit suffix:

| Metric key | Unit |
|---|---|
| `temp_c` | `°C` |
| `temp_f` | `°F` |
| `rain_mm` | `mm` |
| `wind_kmh` | `km/h` |
| `jam_factor` | `` (no unit) |
| Unknown | `` (no unit) |

Metric value displayed with one decimal place.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| No oracle reading | Component returns `null` — block not rendered |
| `reading.value` missing the metric key | Component returns `null` |
| `pricing_inputs.oracleMultiplier` absent | Default to `1.0`, hide price impact line |
| `impactPct === 0` | Hide price impact line |
| `lte`/`lt` operator, `actual = 0` | Proximity = Infinity → clamped to 100%, treated as trigger met |
| Manual trigger type | No readings exist → block hidden |

---

## Architecture

### New file: `components/markets/OracleConditions.tsx`

Pure display component. Props:

```ts
interface Props {
  reading: LatestOracleReading
  triggerCondition: TriggerCondition
  oracleMultiplier: number
}
```

No DB access. No state. Returns `null` for all guard cases listed above.

### Modified: `lib/types.ts`

Add:

```ts
export interface LatestOracleReading {
  value: Record<string, unknown>
  read_at: string
  source: string
  trigger_met: boolean
}
```

### Modified: `app/markets/[slug]/page.tsx`

After the existing `Promise.all` resolves and the contract is confirmed, fetch the latest oracle reading sequentially (it needs the contract ID):

```ts
const [contractResult, userResult] = await Promise.all([contractQuery, userQuery])
if (contractResult.error || !contractResult.data) notFound()

const { data: latestReading } = await supabase
  .from('oracle_readings')
  .select('value, read_at, source, trigger_met')
  .eq('contract_id', contractResult.data.id)
  .order('read_at', { ascending: false })
  .limit(1)
  .maybeSingle()
```

Use `.maybeSingle()` (not `.single()`) — returns `null` with no error when no reading exists. Pass `latestReading` as a prop to `ContractDetailClient`.

### Modified: `components/markets/ContractDetailClient.tsx`

- Accept `latestReading: LatestOracleReading | null` prop
- Derive `oracleMultiplier` from `contract.coverage_tiers[0]?.pricing_inputs?.oracleMultiplier ?? 1.0`
- Render `<OracleConditions />` between `<PriceChart />` and `<ContractMeta />` when `latestReading` is non-null and the metric exists in the reading value

---

## Data Flow

```
app/markets/[slug]/page.tsx
  └─ Promise.all([contractQuery, oracleReadingQuery, userQuery])
  └─ pass latestReading to ContractDetailClient

ContractDetailClient
  └─ derives oracleMultiplier from coverage_tiers[0].pricing_inputs
  └─ renders <OracleConditions reading={latestReading} triggerCondition={...} oracleMultiplier={...} />

OracleConditions
  └─ computes proximity, displayPct, impactPct
  └─ picks state (low / elevated / met)
  └─ renders block
```

---

## Testing

**`tests/components/OracleConditions.test.tsx`** — unit tests:

- Renders metric value and threshold label for `gte` operator
- Computes and displays correct proximity % for `gte`
- Computes and displays correct proximity % for `lte`
- Shows "Premium elevated" + amber impact for multiplier > 1
- Shows "Premium discounted" + green impact for multiplier < 1
- Hides price impact line when `oracleMultiplier === 1.0`
- Shows trigger-met state when `trigger_met: true`
- Returns null when metric key missing from reading value
- Applies correct unit label for known metric keys (`temp_c` → `°C`)

No changes to existing tests — `OracleConditions` is a pure display component with no DB or server dependencies.

---

## Out of Scope

- Inline oracle indicator on tier cards (Option B — not selected)
- Oracle data in the purchase panel / payment step
- Historical oracle readings chart
- Auto-refresh of oracle data on the client (page is server-rendered; readings update on next page load)
