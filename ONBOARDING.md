# Insu — Project Summary

## What It Is

Insu is a **parametric protection marketplace** targeting everyday consumers in Mexico. Users buy coverage against real-life disruptions (traffic delays, weather events, cancelled concerts); if a trigger condition is met and verified by an oracle, payouts are issued automatically — no claims process, no paperwork.

The business model is two-sided:
- **Buyers (Hedgers)** pay a premium for coverage and receive a fixed payout if the trigger fires
- **Capital Providers** deposit into a pool that backs those payouts; if the trigger doesn't fire they keep the premiums as yield

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.2.6, App Router, TypeScript |
| Styling | Tailwind CSS, custom design tokens (`insu-accent`, `insu-text`, etc.) |
| Database & Auth | Supabase (PostgreSQL + RLS + SSR auth via `@supabase/ssr`) |
| Payments | Stripe (PaymentIntents, webhooks) |
| Deployment | Vercel (manual deploy via CLI — GitHub auto-deploy is NOT wired up) |
| Fonts | `next/font/google` — Bebas Neue (display), Outfit (body), JetBrains Mono |
| Charts | Recharts (`PriceChart` component) |
| Oracle data | Tomorrow.io (weather), Waze (traffic/urban) |
| Error tracking | Sentry (partially configured — no auth token set, source maps not uploaded) |
| Testing | Vitest + React Testing Library |

**Deploy command:** `vercel --prod --yes` from the project root.

---

## Core Domain Concepts

### Contracts
The central product unit. Each contract has:
- `trigger_type`: `weather` | `urban` | `event` | `manual`
- `trigger_condition`: JSON object describing the oracle check (metric, comparator, threshold)
- `trigger_deadline`: when the contract expires
- `coverage_tiers`: 2 tiers per contract (Basic and Pro)
- `status`: `pending` → `active` → `settled` / `cancelled`

Recurring contracts (`weather`, `urban`) support **coverage periods** (1, 7, or 30 days), which scale the premium via `computePeriodFactor()`.

### Coverage Tiers
Each contract has two tiers:
- **Basic** — lower premium, lower payout
- **Pro** — higher premium, higher payout

Tier fields: `premium_usd`, `payout_usd`, `max_capacity_usd`, `current_capacity_usd`, `base_probability`, `pricing_inputs`.

### Capacity Model (Option A — implemented May 2026)
`current_capacity_usd` = **provider capital deposited** (fills 0 → max).
- **Providers** fill the pool; deposit increments `current_capacity_usd` on payment activation
- **Buyers** check the pool covers their payout (`current_capacity_usd >= payout_usd`); purchase does NOT touch capacity
- Tier shown as unavailable to buyers when pool < payout; shown as "Pool full" to providers when pool is at max
- DB function: `increment_tier_capacity(p_tier_id, p_amount)`

### Pricing Engine (`lib/pricing/engine.ts`)
Premium is computed dynamically:
```
premium = payout × base_probability × oracleMultiplier × utilizationFactor × timeFactor × loadingFactor (1.15)
```
- `utilizationFactor` rises with pool utilization (encourages providers when under-funded)
- `timeFactor` rises as deadline approaches
- `oracleMultiplier` comes from the latest oracle reading and reflects real-world conditions
- `computePeriodFactor(days, contract)` = `min(1.0, days / contractDays)` — scales premium for short coverage periods

Repricing runs via `/api/reprice` cron.

### Oracle System (`lib/oracle/`)
API route `/api/oracle-poll` fetches readings from external sources and checks trigger conditions:
- **Tomorrow.io** for weather contracts (temperature, rainfall, wind)
- **Waze** for urban/traffic contracts (delay, congestion)
- Readings stored in `oracle_readings` table with `trigger_met` boolean
- Oracle multiplier fed back into pricing on each poll

### Positions
**Hedger positions** (`hedger_positions`): created on payment intent, activated after Stripe confirms. Fields include `premium_paid_usd`, `payout_amount_usd`, `coverage_period_days`, `expires_at`, `status`.

**Provider positions** (`provider_positions`): capital deposit, activated after Stripe confirms. Increments `current_capacity_usd` on activation.

Both share the same `activatePositionByPaymentIntent()` server action, which verifies the Stripe PaymentIntent before activating.

---

## Application Structure

```
app/
  page.tsx                  # Marketplace homepage (contract grid + search)
  markets/[slug]/page.tsx   # Contract detail page (server component)
  dashboard/                # User portfolio — active hedger & provider positions
  how-it-works/             # Static explainer page
  submit/                   # User contract submission form
  auth/login | signup | callback
  admin/
    contracts/              # CRUD for contracts and tiers
    oracle/                 # Manual oracle poll trigger
    trigger/                # Manual contract trigger (for testing)
    scenario/               # Scenario panel (oracle scenario simulation)
    payouts/                # Payout management

api/
  oracle-poll/              # Cron: fetches oracle data, checks triggers
  reprice/                  # Cron: reprices all active tiers
  payout-process/           # Processes payouts to hedgers after settlement
  stripe-webhook/           # Stripe event handler (payment confirmation)

lib/
  actions/                  # Server actions: purchase.ts, admin.ts, dashboard.ts, submit.ts
  oracle/                   # Oracle trigger logic and multi-source fetcher
  pricing/                  # engine.ts (priceTier, computePeriodFactor)
  supabase/                 # server.ts, client.ts, database.types.ts
  utils/                    # capacity.ts, and general utils.ts
  types.ts                  # All shared TypeScript types

components/
  layout/                   # Header (with logo, logout button), SearchInput, CategoryTabs
  markets/                  # ContractDetailClient, PurchasePanel, TierSelector, PriceChart, OracleConditions, ContractMeta
  admin/                    # ContractForm and admin UI components
```

---

## Payment Flow

1. User selects tier (+ period for recurring contracts) on contract detail page
2. Clicks "Buy Protection" or "Provide Capital" → `PurchasePanel` opens
3. Server action creates a Stripe PaymentIntent (`createHedgerPaymentIntent` / `createProviderPaymentIntent`)
4. `StripePaymentForm` collects card details, confirms payment client-side
5. On success, `activatePositionByPaymentIntent()` is called:
   - Verifies PI status with Stripe
   - Updates position status to `active`
   - For providers: increments `current_capacity_usd`
   - For hedgers: increments `total_volume_usd` on the contract
6. Dashboard cache is revalidated

---

## Database Schema (key tables)

| Table | Purpose |
|---|---|
| `contracts` | Core product units |
| `coverage_tiers` | Basic/Pro tiers per contract (capacity + pricing) |
| `hedger_positions` | Buyer purchases |
| `provider_positions` | Capital deposits |
| `oracle_readings` | Oracle data history + trigger results |
| `pricing_history` | Premium snapshots over time (used in PriceChart) |
| `payouts` | Payout records after settlement |
| `profiles` | User roles (`hedger`, `provider`, `admin`, `both`) |
| `categories` | Contract categories (Urban, Nature, Experiences, Events) |

---

## Design System

Dark-theme UI. Key Tailwind tokens:
- `bg-bg` / `bg-bg-card` — page and card backgrounds
- `insu-text` / `insu-muted` / `insu-dim` — text hierarchy
- `insu-accent` — primary amber/orange (`#f5a623`)
- `insu-green` — payout amounts
- `rounded-card` — standard card border-radius
- `font-display` — Bebas Neue (headings/logo)
- `font-mono` — JetBrains Mono (prices, amounts)

Logo: two SVG shapes (pentagon left in `#e8edf5`, parallelogram right in `#f5a623`), inlined in `Header.tsx`.

---

## Known Gaps / To Build Next

- **GitHub → Vercel auto-deploy not connected.** Deploy manually: `vercel --prod --yes`
- **Sentry not fully configured** — no auth token, no source maps
- **No payout automation** — payouts are processed manually via admin panel after settlement
- **Provider yield calculation** — `expected_return_usd` is stored as 0; no yield display in dashboard
- **No user-facing explanation when pool is empty** — tile shows "No capital yet" but no CTA to providers
- **Coverage period for non-recurring contracts** — period selector is hidden for `event`/`manual` types; they always use full contract duration
- **Regulatory** — product is structured as parametric protection, not insurance. Legal structure for Mexico TBD before public launch

---

## Pilot Context (as of May 2026)

Platform is in pre-launch. Strategy:
1. Seed 6–8 providers first (fund 2–3 contracts)
2. Invite 20–25 buyers once pools are funded
3. Focus on CDMX Traffic and one weather contract
4. Key metric: repeat purchase by buyers

Vercel production URL: **https://insu-theta.vercel.app**
