# SP3: Pricing Engine — Spec

**Goal:** Automatically reprice coverage tier premiums every 6 hours and immediately after each confirmed purchase, using an actuarial formula driven by base probability, capacity utilization, and time decay.

---

## Pricing Formula

```
premium_usd = payout_usd × base_probability × utilization_factor × time_factor × loading_factor
```

### Factors

**utilization_factor** — rises as the tier fills up (demand signal):
```
utilization_factor = 1 + 0.5 × (current_capacity_usd / max_capacity_usd)
```
Range: 1.0 (empty) → 1.5 (full)

**time_factor** — flat until 30 days out, then ramps up as deadline approaches:
```
time_factor = 1 + 0.5 × max(0, 1 − days_remaining / 30)
```
Range: 1.0 (>30 days) → 1.5 (at deadline)

**loading_factor** — fixed 15% operational markup:
```
loading_factor = 1.15
```

### Example

Tier: `payout_usd = $500`, `base_probability = 0.10`, 60% capacity filled, 10 days to deadline:
```
utilization_factor = 1 + 0.5 × 0.60 = 1.30
time_factor        = 1 + 0.5 × (1 − 10/30) = 1.33
premium_usd        = 500 × 0.10 × 1.30 × 1.33 × 1.15 ≈ $99.50
```

### Note on Black-Scholes

The `pricing_history` table uses `bs_inputs`/`bs_output` column names — a placeholder for a future Black-Scholes adaptation. True BS requires a continuously observable underlying asset price and historical volatility (σ), neither of which exists yet in the data model. The actuarial formula above is the correct choice until oracle readings (SP4) provide a live risk index per contract. The JSON columns will store actuarial inputs/outputs for now, and can be extended to true BS inputs later without a schema change.

---

## Architecture

### New files

**`lib/pricing/engine.ts`** — pure function, no DB access:
```ts
priceTier(tier: CoverageTier, contract: Contract): {
  premiumUsd: number
  inputs: { utilization: number; daysRemaining: number; utilizationFactor: number; timeFactor: number; loadingFactor: number }
}
```
Takes a tier and its contract, returns the new premium and a structured inputs record. No side effects — all logic is unit-testable without mocking.

**`lib/pricing/reprice.ts`** — orchestrator:
```ts
repriceAll(): Promise<void>       // reprices all active tiers
repriceTier(tierId: string): Promise<void>  // reprices one tier (used by webhook)
```
Each call:
1. Fetches tier + contract from Supabase
2. Calls `priceTier()` to get new premium and inputs
3. Updates `coverage_tiers` (`premium_usd`, `last_priced_at`, `pricing_inputs`)
4. Inserts a row into `pricing_history` (`premium_usd_before`, `premium_usd_after`, `bs_inputs`, `bs_output`)

**`app/api/reprice/route.ts`** — Next.js POST endpoint:
- Verifies `Authorization: Bearer $CRON_SECRET` header
- Returns 401 if missing or wrong
- Calls `repriceAll()` and returns `{ repriced: n }` count
- Can also be called manually for testing: `curl -X POST localhost:3000/api/reprice -H "Authorization: Bearer $CRON_SECRET"`

**`vercel.json`** — Vercel cron configuration:
```json
{
  "crons": [{ "path": "/api/reprice", "schedule": "0 */6 * * *" }]
}
```
Vercel automatically passes `Authorization: Bearer $CRON_SECRET` on cron-triggered calls.

### Modified files

**`app/api/stripe-webhook/route.ts`** — after updating a hedger or provider position to `active`, call `repriceTier(position.tier_id)` to immediately reflect the capacity change.

### Environment variable

```
CRON_SECRET=a_random_secret_string
```
Add to `.env.local` and Vercel project settings.

---

## Data writes per reprice run

### `coverage_tiers` update
```sql
UPDATE coverage_tiers
SET premium_usd = $new,
    last_priced_at = now(),
    pricing_inputs = $inputs_json
WHERE id = $tier_id
```

### `pricing_history` insert
```sql
INSERT INTO pricing_history
  (contract_id, tier_id, bs_inputs, bs_output, premium_usd_before, premium_usd_after, calculated_at)
VALUES
  ($contract_id, $tier_id, $inputs_json, $output_json, $old_premium, $new_premium, now())
```

`bs_inputs` stores: `{ utilization, daysRemaining, utilizationFactor, timeFactor, loadingFactor }`
`bs_output` stores: `{ premiumUsd }`

---

## Testing

### Unit tests — `tests/lib/pricing/engine.test.ts`

Pure function, no mocks needed:

| Test | Assertion |
|---|---|
| Premium increases as utilization rises | 0% < 50% < 100% utilization |
| Premium increases as deadline approaches | 60 days < 15 days < 2 days remaining |
| Premium is flat beyond 30 days | 60-day and 45-day results are equal |
| Known inputs produce known output | snapshot: 500 × 0.10 × 1.30 × 1.33 × 1.15 ≈ 99.5 |
| Loading factor always applied | output always > payout × probability |

### Integration tests — `tests/lib/pricing/reprice.test.ts`

Supabase client mocked:

| Test | Assertion |
|---|---|
| `repriceAll` updates each active tier | `update` called once per tier |
| `repriceAll` inserts pricing_history row per tier | `insert` called once per tier |
| `repriceTier` scopes to one tier only | only one `update` + one `insert` |
| Skips settled contracts | no writes when contract status ≠ active |

### API route tests — `tests/api/reprice.test.ts`

| Test | Assertion |
|---|---|
| Returns 401 without secret | missing header → 401 |
| Returns 401 with wrong secret | bad value → 401 |
| Returns 200 with correct secret | calls repriceAll, returns count |

---

## File map

```
lib/pricing/
  engine.ts
  reprice.ts
app/api/
  reprice/
    route.ts
  stripe-webhook/
    route.ts          (modify: call repriceTier after position activation)
vercel.json           (create or modify: add cron entry)
tests/
  lib/pricing/
    engine.test.ts
    reprice.test.ts
  api/
    reprice.test.ts
.env.local.example    (add CRON_SECRET)
```

---

## Out of scope for SP3

- MXN premium repricing (requires live FX rate feed)
- Black-Scholes formula (requires oracle readings from SP4)
- Admin UI to view reprice history
- Per-contract pricing overrides
