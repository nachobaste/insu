# Oracle Scenario Panel — Design Spec

**Date:** 2026-05-23  
**Status:** Approved  
**Purpose:** Admin tool for injecting manual oracle readings to simulate trigger conditions — for demos and testing without waiting for real API data.

---

## Problem

The oracle poller runs once daily at midnight UTC. Testing a full purchase → trigger → payout cycle requires either waiting for a real weather/urban event or waiting for the cron. Neither is viable for demos or development.

## Solution

A new admin page (`/admin/scenario`) that lets an admin inject a manual `oracle_readings` row for any active contract, evaluate whether it meets the trigger threshold, and link directly to the Trigger page to settle immediately.

---

## Architecture

### New files

| File | Type | Responsibility |
|---|---|---|
| `app/admin/scenario/page.tsx` | Server component | Fetch active contracts with trigger conditions, render ScenarioPanel |
| `components/admin/scenario/ScenarioPanel.tsx` | Client component | Form, submission, inline result display |
| `lib/actions/oracle/injectReading.ts` | Server action | Validate JSON, evaluate trigger, insert oracle_readings row |

### Admin sidebar

Add "Scenario" entry to the admin nav between Oracle and Trigger.

---

## Data Flow

```
1. Page loads → fetch contracts (status=active, settled_outcome=null)
                                    ↓
2. User selects contract → trigger_condition displayed, JSON textarea pre-filled
                                    ↓
3. User edits value, clicks "Inject Reading"
                                    ↓
4. injectReading(contractId, valueJson, source)
      → parse JSON
      → fetch contract trigger_condition
      → evaluateTrigger(condition, parsedValue) → trigger_met: true/false
      → INSERT oracle_readings { contract_id, source, reading_type: 'manual',
                                  value, trigger_met, read_at: now() }
      → return { trigger_met, metric, threshold, operator, actual_value, reading_id }
                                    ↓
5. Result card renders inline below form
```

The payout processor (`/api/payout-process`) runs at midnight UTC and will auto-settle any contract with `trigger_met: true` readings. For immediate demo settlement, use the Trigger page link in the result card.

---

## UI

### Form

```
Contract
┌──────────────────────────────────────────────┐
│  Rain CDMX  ▾                                │
└──────────────────────────────────────────────┘

Trigger condition  (read-only context)
┌──────────────────────────────────────────────┐
│  precipitation_mm  ≥  30                     │
└──────────────────────────────────────────────┘

Reading value (JSON)
┌──────────────────────────────────────────────┐
│  {                                           │
│    "precipitation_mm": 45                    │
│  }                                           │
│                                              │
└──────────────────────────────────────────────┘

Source label  [ manual              ]

[ Inject Reading ]
```

- Contract dropdown: only active, unsettled contracts
- Trigger condition: auto-populated from `contract.trigger_condition`, read-only
- JSON textarea: pre-filled with `{ "<metric>": <threshold_value> }` as a starting point
- Source label: free text, defaults to `"manual"`
- Button disabled while loading

### Result card (appears below form after submit)

**Trigger met:**
```
✓  Reading written

   TRIGGER MET: YES
   precipitation_mm = 45  ≥  threshold 30

   [ Settle this contract now → ]   (/admin/trigger?contract=<slug>)
```

**Trigger not met:**
```
✓  Reading written

   TRIGGER NOT MET
   precipitation_mm = 10  ≥  threshold 30  ✗

   (Trigger condition was not satisfied — contract remains active)
```

- Result card replaces itself on each new injection (no history list — OracleMonitor already shows that)
- "Settle this contract now" link pre-selects the contract on the Trigger page

---

## Server Action: `injectReading`

```ts
interface InjectResult {
  ok: true
  trigger_met: boolean
  metric: string
  operator: string
  threshold: number
  actual_value: number
  reading_id: string
}

async function injectReading(
  contractId: string,
  valueJson: string,
  source: string,
): Promise<InjectResult | { ok: false; error: string }>
```

**Validation:**
- JSON must parse successfully
- Contract must exist and be active + unsettled
- User must be authenticated (admin check via Supabase auth)

**Error cases returned to client (not thrown):**
- Invalid JSON
- Contract not found or already settled
- DB insert failure

---

## Admin Sidebar Update

Add "Scenario" between Oracle and Trigger in the admin nav component. Route: `/admin/scenario`.

---

## What This Does NOT Do

- No auto-settle on inject — user goes to Trigger page manually
- No historical list of injected readings — OracleMonitor shows all readings including manual ones
- No multi-step wizard — single form, single submit
- No compound trigger support beyond what `evaluateTrigger` already handles

---

## Testing

- Unit test `injectReading` action: valid JSON triggers correctly, invalid JSON returns error, already-settled contract returns error
- Manual test: inject reading above threshold → confirm row in Supabase → confirm link goes to Trigger page with contract pre-selected

---

## Demo Flow (end-to-end)

1. `/admin/scenario` → pick contract, set value above threshold → Inject Reading
2. Result: "Trigger met: YES"
3. Click "Settle this contract now" → `/admin/trigger?contract=rain-cdmx`
4. Force-settle → payouts queued
5. Check dashboard / Payouts page → hedger positions show `paid_out`
