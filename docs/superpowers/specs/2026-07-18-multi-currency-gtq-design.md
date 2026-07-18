# Multi-currency display (USD + contract-local Q/MXN) — Design

**Date:** 2026-07-18
**Status:** Approved (design), pending implementation plan
**Branch:** `feat/multi-currency-display`

## Problem

Guatemalan contracts (traffic + fuel) should show quotes in **quetzales (Q / GTQ)**, and Mexican contracts in **pesos (MXN)**, based on the user's preferred currency in their profile. Today:

- `Currency = 'USD' | 'MXN'` only (`lib/types.ts:7`) — no GTQ anywhere.
- `coverage_tiers` has only `*_usd` and `*_mxn` columns — no place to store a quetzal quote.
- The profile selector offers only USD/MXN; `lib/actions/profile.ts` hard-validates `['USD','MXN']`.
- Guatemalan contracts' `*_mxn` columns hold **pesos at 17.0 FX**, not quetzales.
- The preferred-currency toggle is effectively inert: `app/BrowseClient.tsx` hardcodes `currency="USD"` (lines 77/87/98/102) and `components/markets/ContractDetailClient.tsx` ignores currency entirely.

## Goal / Non-goals

**Goal:** A user can view contract prices in USD or the contract's local currency (Q for GT, MXN for MX), driven by a profile display-mode preference, applied everywhere prices are shown.

**Non-goals (YAGNI):**
- No change to what the user is charged — Stripe charges **USD** (`purchase.ts:129`); this is display-only.
- No live FX feed (config constants instead).
- No new local-amount DB columns (compute from USD at render).
- No React context provider (prop-threading instead).
- No currencies for AR/BR/CA/CL/CO yet — they fall back to USD.

## Key decisions (from brainstorming)

1. **Currency model:** USD + the contract's own local currency, determined by `location.country` (GT→Q, MX→MXN). A GT contract never shows MXN and vice-versa.
2. **FX source:** config constants in code, computed at render (`local = USD × rate`). No stored local columns; avoids the stale-sticker class of bug that broke GT's FX.
3. **Preference:** a display **mode** `'USD' | 'LOCAL'`, not a fixed fiat. Each screen resolves `'LOCAL'` to the contract's currency (or USD if the country has no configured rate).
4. **Purchased positions (dashboard):** recompute local amounts from `*_usd × current rate` via the same helper — one code path, app-wide consistency. (No real positions exist, so no historical accuracy is lost.)

## Architecture

### A. New pure module `lib/currency/`

Small, well-bounded, unit-testable; no DB or React dependencies.

**`config.ts`**
- `FX_RATES: Record<LocalCurrency, number> = { MXN: 17.0, GTQ: 7.75 }` — local units per USD. MXN keeps today's 17.0; GTQ ~7.75 (current quetzal rate; a code constant, update as needed).
- `COUNTRY_CURRENCY: Record<string, LocalCurrency> = { MX: 'MXN', GT: 'GTQ' }`.
- Types: `LocalCurrency = 'MXN' | 'GTQ'`, `DisplayCurrency = 'USD' | LocalCurrency`, `DisplayMode = 'USD' | 'LOCAL'`.

**`resolve.ts`** (pure functions)
- `localCurrencyForCountry(country?: string): LocalCurrency | null` — normalizes (`'Mexico' → 'MX'`, uppercases/trims), returns configured currency or `null`.
- `resolveDisplayCurrency(mode: DisplayMode, country?: string): DisplayCurrency` — `'USD'` → `USD`; `'LOCAL'` → `localCurrencyForCountry(country) ?? 'USD'`.
- `convertFromUsd(amountUsd: number, currency: DisplayCurrency): number` — `amountUsd × rate` (rate 1 for USD), rounded to whole units.
- `displayPrice(amountUsd, mode, country): { amount, currency, formatted }` — the single call sites use.

### B. Type + formatter + preference migration

- Widen `Currency` in `lib/types.ts` to `'USD' | 'MXN' | 'GTQ'`.
- `formatCurrency` (`lib/utils.ts`): use `currencyDisplay: 'narrowSymbol'` so GTQ renders `Q780` (not the redundant `GTQ 780 GTQ`); keep the ISO-code suffix for disambiguation.
- **Preference → display mode.** Repurpose the existing `preferred_currency` column to store `'USD' | 'LOCAL'`.
  - Data migration: `UPDATE profiles SET preferred_currency='LOCAL' WHERE preferred_currency='MXN';`
  - `lib/actions/profile.ts`: validation → `['USD','LOCAL']`.
  - `components/profile/ProfileForm.tsx` + `app/profile/page.tsx`: toggle label → "Show prices in: US Dollars / Local currency"; types → `'USD' | 'LOCAL'`.
  - `lib/supabase/database.types.ts`: reflect the same.

### C. Wiring the preference through render surfaces

**Chosen approach: prop-threading (not a context provider).** The `currency` prop already flows through the card components, and `app/page.tsx` / detail pages are server components that can read the profile. Smallest change, matches existing pattern. Toggle applies on next navigation.

Surfaces:
- `app/page.tsx` → read the user's mode (anonymous → `'USD'`), pass `displayMode` into `BrowseClient` (removing the hardcoded `currency="USD"`).
- `components/contracts/ContractCard.tsx`, `ContractSection.tsx`, `TrendingSection.tsx`, `ComingSoonSection.tsx`, `CorridorPairCard.tsx` → accept `displayMode`, compute each contract's price via `displayPrice(tier.premium_usd, mode, contract.location?.country)` and likewise for payout.
- `components/markets/ContractDetailClient.tsx` (purchase) → show the resolved currency **plus a secondary `≈ $X USD` line**, since the actual Stripe charge is USD (transparency).
- `app/dashboard/*` (`PositionCard.tsx`, `PayoutRow.tsx`, `PayoutsTab.tsx`) → recompute from `*_usd` via the helper using the position's contract country + user mode.
- `lib/actions/purchase.ts` — unchanged; still charges USD. Position `*_mxn` writes left as legacy (dashboard recomputes from USD, so they are not read for display).

## Data flow

1. Server component (`app/page.tsx`, market detail, dashboard) reads `profiles.preferred_currency` → `mode: DisplayMode` (anonymous → `'USD'`).
2. `mode` threaded as a prop to price-rendering components.
3. Each component, per contract, calls `displayPrice(amountUsd, mode, contract.location?.country)` → resolves currency and converts from the authoritative USD value.
4. `formatCurrency` renders the symbol; where the resolved currency ≠ USD on the purchase screen, also render `≈ $USD`.

## Error handling / edge cases

- Anonymous users / null preference → `'USD'` mode.
- `location.country` missing or unconfigured (AR/BR/CA/CL/CO, `'(none)'`) → `'LOCAL'` resolves to `USD`.
- `'Mexico'` (legacy typo in one cancelled contract) → normalized to `MX`.
- Rounding: whole units (`maximumFractionDigits: 0`), consistent with current `formatCurrency`.
- FX constants are the single source of truth; changing `FX_RATES` updates every surface at once.

## Testing

- **Unit (`lib/currency/resolve.ts`):** country normalization; `resolveDisplayCurrency` for USD mode, LOCAL→GT (GTQ), LOCAL→MX (MXN), LOCAL→unknown (USD); `convertFromUsd` rounding for MXN and GTQ.
- **Render:** a GT contract shows `Q…` in LOCAL mode; an MX contract shows `MX$…`; an unknown-country contract shows `$…` in LOCAL mode; USD mode always shows `$…`.
- **Profile action:** accepts `USD`/`LOCAL`, rejects legacy `MXN`/`GTQ`/garbage.
- **Formatter:** GTQ renders `Q…` without the redundant double code.

## Rollout notes

- Data migration on `profiles.preferred_currency` (single `UPDATE`); Supabase single prod DB `eagmczieznsogsxldedk` — apply via `supabase db push`.
- No reprice needed; feature is display-only over existing `*_usd` values.
- Deploy is manual (`vercel --prod --yes`, once) per project convention.
