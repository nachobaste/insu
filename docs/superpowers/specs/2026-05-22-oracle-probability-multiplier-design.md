# Oracle Probability Multiplier — Design Spec

**Date:** 2026-05-22
**Status:** Approved

## Summary

Wire live oracle readings into the pricing engine via a multiplier on `base_probability`. When conditions approach the trigger threshold, premiums rise. When conditions are favorable, premiums fall. `base_probability` stays unchanged — it remains the admin-set long-run rate.

---

## Multiplier Formula

Computed from the latest oracle reading for the contract at reprice time.

```
proximity_ratio = actual_value / threshold         (for gte / gt operators)
               = threshold / actual_value          (for lte / lt operators)

oracle_multiplier = clamp(proximity_ratio, 0.3, 3.0)
```

### Behavior table

| Conditions | Proximity | Multiplier | Effect on premium |
|---|---|---|---|
| Very far from threshold | 0.3 | 0.30 | −70% |
| Well below threshold | 0.5 | 0.50 | −50% |
| Halfway to threshold | 0.8 | 0.80 | −20% |
| At threshold | 1.0 | 1.00 | No change |
| 50% past threshold | 1.5 | 1.50 | +50% |
| 2× past threshold | 2.0 | 2.00 | +100% |
| Extreme (capped) | ≥3.0 | 3.00 | +200% (max) |

**Default:** When no oracle reading exists (manual trigger type, readings not yet collected), multiplier = 1.0. Pricing is unchanged.

---

## Pricing Formula (updated)

```
premium = payout_usd
        × (base_probability × oracle_multiplier)
        × utilizationFactor
        × timeFactor
        × loadingFactor
```

`base_probability` is never mutated. The multiplier is applied inline at price time.

---

## Architecture

### New file: `lib/oracle/multiplier.ts`

Pure function. No DB access. Fully unit-testable in isolation.

```ts
computeOracleMultiplier(
  reading: { value: Record<string, unknown> },
  condition: TriggerCondition,
): number
```

Returns a number in [0.3, 3.0]. Returns 1.0 if the metric is missing from the reading or if the value is not a number.

### Modified: `lib/pricing/engine.ts`

`priceTier` gains an optional parameter:

```ts
priceTier(tier: CoverageTier, contract: Contract, oracleMultiplier = 1.0): PricingResult
```

`PricingInputs` gains `oracleMultiplier: number` so the value is recorded in `pricing_inputs` (on `coverage_tiers`) and `bs_inputs` (on `pricing_history`) for full audit trail.

### Modified: `lib/pricing/reprice.ts`

`applyReprice` receives the latest oracle reading (fetched by the orchestrator). It calls `computeOracleMultiplier` before calling `priceTier`.

`repriceAll`: after fetching contracts with their tiers, also fetches the latest oracle reading per contract (single query via `.order('read_at', { ascending: false }).limit(1)`).

`repriceTier`: same — fetches the contract's latest oracle reading before pricing.

---

## Data Flow

```
Oracle poll (every 5 min)
  └─ writes oracle_readings row

Reprice cron (every 6h) or post-purchase webhook
  └─ fetch active contracts + coverage_tiers
  └─ fetch latest oracle_reading per contract
  └─ computeOracleMultiplier(reading, contract.trigger_condition)
  └─ priceTier(tier, contract, oracleMultiplier)
  └─ update coverage_tiers.premium_usd + pricing_inputs
  └─ insert pricing_history row (includes oracleMultiplier in bs_inputs)
```

---

## Schema Changes

None. `pricing_inputs` and `bs_inputs` are JSONB columns — the new `oracleMultiplier` field is added to the JSON payload without any migration.

---

## Error Handling

- Reading value is not a number → return 1.0 (no adjustment, log warning)
- No reading found for contract → return 1.0 (no adjustment, silent)
- Division by zero (threshold = 0) → return 1.0 (guard in formula)
- Multiplier is always clamped to [0.3, 3.0] — no unbounded outputs

---

## Testing

- `tests/lib/oracle/multiplier.test.ts` — unit tests: gte/lte/gt/lt operators, at-threshold, above/below, clamp edges, missing metric, non-numeric value, zero threshold
- `tests/lib/pricing/engine.test.ts` — add: multiplier=2 doubles effective probability; multiplier=1 (default) matches existing behavior
- `tests/lib/pricing/reprice.test.ts` — add: reprice reads latest oracle reading and passes computed multiplier; contracts with no readings use multiplier=1.0

---

## Out of Scope

- Trend/rate-of-change signal (can be added later as a second multiplier)
- Per-category multiplier caps (can be added later via config)
- Storing oracle_multiplier as a dedicated DB column (JSONB audit trail is sufficient)
