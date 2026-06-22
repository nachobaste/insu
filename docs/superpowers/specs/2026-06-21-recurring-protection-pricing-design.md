# Recurring Protection Pricing — Design Spec

**Date:** 2026-06-21
**Status:** Approved (pending written-spec review)
**Branch:** `feat/recurring-derivative-pricing`

## Problem

Recurring protections (traffic corridors, weather) show one price when you land on
the contract and a very different price once you pick a coverage period. Root cause:
the detail page renders the tier's stored `premium_usd` unfactored (a full
**contract-window** premium), then prorates it down by `periodDays / contractDays`
against an arbitrary, far-off `trigger_deadline`. The headline price corresponds to
nothing the user can actually buy.

More fundamentally, the underlying model is wrong for this product. A recurring
protection is not a fixed-deadline event — it is a **perpetual, continuously-quoted
market** in which each buyer purchases coverage for a chosen tenor. It must be priced
like a financial derivative (a binary/digital option), where the only thing that
matters is **time-to-expiration of the position**, not any contract-level deadline.

This spec redefines recurring-protection pricing on derivative foundations. One-time
contracts (`events`, `experiences`) are explicitly **out of scope and unchanged**.

## Core principles

1. **Recurring contracts (`urban`, `nature`) are perpetual.** No `trigger_deadline`;
   it is irrelevant to pricing and validity. The market never settles.
2. **Each purchase is an independent position** with its own clock: covered from
   purchase time for the chosen **tenor** (1, 7, or 30 days). Expiry is per-position,
   like an option's tenor — independent of every other holder.
3. **A recurring protection is a binary/digital option:** it pays a fixed `payout`
   if the trigger condition (the strike) is breached during the position's tenor.
4. **Everything derives from one daily hazard rate `p`**, and one valuation function
   from which both the premium and time-decay/moneyness emerge.
5. **Pricing must be explainable** to first users and investors in one sentence, while
   leaving the structure in place to incorporate observed history later.

---

## 1. Contract families

| Family | Trigger types | Structure |
|---|---|---|
| **Recurring** | `urban`, `nature` | Perpetual market. No deadline. Per-position tenor. New pricing (this spec). |
| **One-time** | `events`, `experiences` | Unchanged. Fixed deadline, single occurrence, existing pricing. |

The `is_recurring` flag (already present) selects behavior throughout.

## 2. The underlying: daily hazard rate `p`

One number drives all quotes:

```
p = clamp( base_probability × oracleMultiplier(latest_reading), P_MIN, P_MAX )
```

- `base_probability` — **re-interpreted as the daily baseline hazard** (probability the
  trigger fires on a given day). Admin-set per corridor for v1. Semantic redefinition
  of the existing column; no schema change.
- `oracleMultiplier ∈ [0.3, 3.0]` — from the existing `computeOracleMultiplier(reading,
  condition)`. Its proximity-to-strike logic rises as conditions approach the trigger,
  so it **is the option's moneyness/delta**.
- `P_MIN`, `P_MAX` — clamp bounds (e.g. `0.0005`, `0.95`) so `base × 3.0` cannot exceed
  a sane ceiling or hit 0/1.

**Future (credibility blending, "Option C"):** `oracle_readings.trigger_met` already
records realized trigger-days per corridor, so `base_probability` can later be blended
with the empirical rate. No new table needed now. The structure must exist; the blend
is not implemented in v1.

## 3. The valuation function

Let `N` = number of trigger-days in a window, modeled as `N ~ Binomial(T, p)` (at most
one payout per calendar day). Exact tail probabilities:

```
P(N≥1) = 1 − (1−p)^T
P(N≥2) = P(N≥1) − T·p·(1−p)^(T−1)
P(N≥3) = P(N≥2) − C(T,2)·p²·(1−p)^(T−2)
```

### Premium at purchase (tenor `T`)

```
Basic (one-touch):  premium = payout × P(N≥1)                 × loading × capacityFactor
Pro   (cap 3):      premium = payout × Σ_{k=1..3} P(N≥k)      × loading × capacityFactor
```

- `loading = 1.15` — explicit house margin.
- `capacityFactor = min(1.5, 1 + 0.5 × utilization)`, `utilization = reserved / max_capacity`.
  This is the **(B) capacity/demand factor** — the existing `utilizationFactor` formula,
  kept and re-labeled. Bounded 1.0×–1.5×. Makes the market reprice on supply/demand.
- **Pro ≥ Basic always** (same base plus 2nd/3rd-event terms); Pro capital-bounded at
  `3 × payout`.

### Live value of an open position (mark-to-market)

Same function, `τ` = remaining days, `p_now` = current hazard, marked at **fair value —
no loading, no capacity factor** (the honest economic worth and the basis for future
cash-out):

```
Basic open:  V = payout × P(N_τ ≥ 1 | p_now)
Pro open:    V = payout × Σ_{k=1..r} P(N_τ ≥ k | p_now)     r = payouts remaining (3 − used)
```

- **Theta:** `τ → 0` while out-of-the-money (low `p_now`) → `V → 0`.
- **Delta/moneyness:** conditions approach strike → `oracleMultiplier` spikes `p_now` →
  `V → payout` even with little time left.
- The old multiplicative `timeFactor` and `computePeriodFactor` are **deleted**. Decay is
  now real, emergent from `τ` in the exponent — not a deadline-anchored hack.

## 4. Position lifecycle & capital reservation

On **purchase** of a recurring protection:

- `purchased_at = now`, `expires_at = now + tenor` (columns already exist).
- `payouts_remaining = tier.max_payouts` (Basic 1, Pro 3); `payouts_made = 0`.
- `reserved_usd = max_payouts × payout_usd` — locked from the tier's pool at bind time.
- **Availability gate:** a tier is buyable only if
  `current_capacity_usd − Σ reserved(open positions) ≥ max_payouts × payout_usd`.

On **expiry** (window closes, payouts not exhausted): status `expired`, release remaining
`reserved_usd` back to the pool. No payout for unused coverage.

## 5. Settlement — per-position; recurring contracts never settle

`settleContract` branches on `is_recurring`:

- **One-time (`events`/`experiences`):** unchanged — existing contract-level settle.
- **Recurring:** **never modify contract status.** The processor must evaluate **all
  distinct trigger-days** for the contract (not just the earliest, as today). For each
  active position, for each distinct trigger-day falling inside its window
  `[purchased_at, expires_at]` and after the position's `last_payout_date`:
  - Pay `1 × payout` for that day — **at most one payout per calendar day**, guarded by a
    new `last_payout_date` column.
  - `payouts_made++`, `payouts_remaining--`; reduce `reserved_usd` and the tier's
    `current_capacity_usd` by `payout`.
  - When `payouts_remaining == 0` → status `knocked_out` (closed). Basic knocks out on its
    first payout by construction.
  - The market stays `active` and keeps quoting.

**Idempotency** changes from "one payout per position" to **"one payout per (position,
day)"** — keyed on `last_payout_date` plus the existing `payouts`-table check.

**Providers:** capital is a **standing pool**; each payout draws down `current_capacity_usd`
pro-rata across providers. Provider positions remain open (no per-contract settle, since the
contract never settles). Explicit provider withdrawal/settlement is **out of scope** for this
build; pool accounting supports adding it later.

## 6. Live valuation on the dashboard (scope ii) + rails for cash-out (iii)

The dashboard renders each open position's fair value `V(τ_remaining, p_now)` (§3) alongside
premium paid and payouts collected. Pure display, powered by a shared
`valuePosition(position, reading)` function. The position columns (`purchased_at`,
`expires_at`, `reserved_usd`, `payouts_remaining`) are exactly what a future **early cash-out
(iii)** needs — it would close the position and credit `V`. No extra modeling now; cash-out
itself is not implemented in v1.

## 7. Data-model changes

- **`hedger_positions`** — add: `payouts_remaining int`, `payouts_made int default 0`,
  `last_payout_date date`, `reserved_usd numeric`. New status value: `knocked_out`.
  (`expires_at`, `coverage_period_days`, `purchased_at` already exist.)
- **`coverage_tiers`** — add: `max_payouts int` (Basic 1, Pro 3). `base_probability`
  re-interpreted as the daily hazard (semantic). `premium_usd` **demoted to a cached
  display "sticker price"** = the 1-day Basic premium, refreshed by the reprice job, **never**
  the basis for the charged amount.
- **`contracts`** — set `trigger_deadline = NULL` for all `urban`/`nature`.
- **History:** none needed for v1 (`oracle_readings.trigger_met` suffices for later blending).

## 8. Pricing module (`lib/pricing/`)

New, individually unit-testable functions:

- `dailyHazard(tier, reading) → p`
- `probAtLeastK(T, p, k) → number` (exact Binomial tail)
- `priceTenor(tier, T, p, { loading, capacityFactor }) → premium` — Basic vs Pro via
  `max_payouts`
- `valuePosition(position, p_now) → fairValue`

**Removed:** `computePeriodFactor`; the deadline-anchored `timeFactor` inside `priceTier`.
`priceTier` is refactored/retired in favor of `priceTenor`. Callers updated: `reprice.ts`
(refresh the cached sticker price), `purchase.ts` (charge the live `priceTenor`), the detail
page, the purchase panel, and `TierSelector`.

## 9. UX fix (the original bug)

- **Detail page + purchase panel:** drop `premium_usd × periodFactor`. Each tenor button and
  tier card shows the **live engine price** for that (tenor, tier). **Default-select the
  1-day tenor** so there is never an unfactored headline — landing price == buy price ==
  browse "from" price.
- **Browse cards:** "from $X" = cheapest entry = **1-day Basic** price.

## 10. Migration

One-time migration + data script:

1. Add the columns in §7; set `max_payouts` (Basic 1, Pro 3).
2. `trigger_deadline = NULL` for `urban`/`nature`.
3. Set each recurring corridor's `base_probability` to a sensible **daily** baseline
   (replacing the old full-window value).
4. Backfill open positions: `payouts_remaining = max_payouts`,
   `reserved_usd = max_payouts × payout`.
5. Refresh `premium_usd` sticker price (1-day Basic) via reprice.

## 11. Testing strategy

- **Pricing units:** `probAtLeastK` correctness vs hand-computed values; `priceTenor`
  strictly increasing in `T` and in `p`; **Pro ≥ Basic**; Pro saturates at the 3-event cap;
  `valuePosition → 0` as `τ→0` when OTM and `→ payout` as `p→high`.
- **Settlement:** one payout per (position, day); Pro pays ≤ 3 then `knocked_out`; recurring
  contract stays `active`; expiry releases `reserved_usd`; idempotent across retries.
- **Components:** detail-page price identical from landing → buy; dashboard renders live mark.
- **Gate:** full vitest suite + lint + `tsc --noEmit` + `next build` green before completion.

## Out of scope

- One-time `events`/`experiences` pricing (unchanged).
- Early cash-out / secondary market (scope iii/iv) — structure only.
- Credibility-weighted history blending (structure only; v1 uses admin base).
- Explicit provider withdrawal/settlement for recurring pools.
