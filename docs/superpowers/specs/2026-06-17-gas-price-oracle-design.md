# Gas Price Oracle — Design Spec

**Date:** 2026-06-17
**Status:** Approved

---

## Overview

Add a `fuel` contract type to Insu that pays out when gas prices in CDMX rise above (or fall below) a threshold. Prices are sourced daily from the CRE (Comisión Reguladora de Energía) via the `api.datos.gob.mx` open data API — the same authoritative prices gas stations are legally required to follow.

Pilot scope: CDMX only. Fuel types: Magna, Premium, Diesel. Poll frequency: once daily at 10am CDMX (after CRE publishes).

---

## Data Model

### Trigger type

Add `'fuel'` to the existing `trigger_type` enum. One migration, no other schema changes.

### Trigger condition shape

```json
{
  "fuel_type": "magna" | "premium" | "diesel",
  "metric": "price_mxn_per_liter",
  "comparator": "gt" | "gte" | "lt" | "lte",
  "threshold": 25.50,
  "region": "cdmx"
}
```

The existing `oracle_readings` table (`value`, `trigger_met`, `trigger_condition`) and pricing engine are unchanged.

---

## Oracle Fetcher

**File:** `lib/oracle/gasFetcher.ts`

Follows the same pattern as `lib/oracle/fetcher.ts` (Tomorrow.io / Waze). Hits the CRE dataset on `api.datos.gob.mx`, filters for the CDMX region, and returns the price per liter for the requested fuel type.

```ts
fetchGasPrice(fuelType: 'magna' | 'premium' | 'diesel'): Promise<number>
```

- Exact endpoint and response shape confirmed during implementation by inspecting the live API
- On fetch failure: log and skip the reading cycle (no crash, no false trigger)
- Returns price in MXN/liter

---

## Oracle Poll Integration

`/api/oracle-poll` adds one new branch to its existing `trigger_type` switch:

```ts
case 'fuel': {
  const price = await fetchGasPrice(contract.trigger_condition.fuel_type)
  const trigger_met = evaluate(price, contract.trigger_condition)
  // store reading, update oracle_multiplier — same pattern as weather/urban
}
```

The existing `evaluate()` helper handles all comparators — no changes needed there.

**Cron schedule:** Adjusted to 10am CDMX (UTC-6 → 16:00 UTC) in `vercel.json` to run after CRE's daily publish window.

---

## Admin UI

`components/admin/ContractForm` gains fuel-specific trigger condition fields when `trigger_type === 'fuel'`:

| Field | Control | Notes |
|---|---|---|
| Fuel type | Select | Magna / Premium / Diesel |
| Comparator | Select | gt / gte / lt / lte (reuse existing) |
| Threshold | Number input | Pesos per liter |
| Region | — | Hardcoded `cdmx`, not shown |

No other UI changes. Marketplace, contract detail, price chart, and dashboard all work off the existing schema.

---

## Change Surface

| Location | Change |
|---|---|
| `supabase/migrations/` | Add `'fuel'` to `trigger_type` enum |
| `lib/types.ts` | Add `'fuel'` to `TriggerType` |
| `lib/oracle/gasFetcher.ts` | New file — CRE API fetcher |
| `app/api/oracle-poll/route.ts` | New `case 'fuel'` branch |
| `vercel.json` | Cron time → 16:00 UTC |
| `components/admin/ContractForm.tsx` | Fuel condition fields |

Pricing engine, capacity model, Stripe flow, and dashboard are untouched.

---

## Out of Scope

- Multi-city support (Guadalajara, Monterrey) — add later by extending `region`
- Per-station granularity (PROFECO) — regional CRE price is sufficient for parametric contracts
- Automatic contract seeding — first fuel contracts created manually via admin panel
