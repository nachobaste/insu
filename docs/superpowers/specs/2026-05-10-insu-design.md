# Insu Platform — Design Spec
**Date:** 2026-05-10  
**Tagline:** Everyday Risk, Instantly Covered  
**Status:** Approved for implementation

---

## 1. Problem

Modern life is increasingly exposed to frequent, small but financially and emotionally painful disruptions — power outages, event cancellations, extreme weather, urban disruptions. Traditional insurance is poorly suited to these risks: slow claims, high fixed costs, minimum thresholds too high, poor UX for small frequent events. Millions of people already intuitively price these risks daily but lack a simple, trusted way to transfer them.

---

## 2. Solution

**Insu** is a parametric event-protection platform — a two-sided marketplace where:

- **Hedgers (buyers)** pay a premium and receive an automatic payout if an objective trigger occurs
- **Risk providers (sellers)** pool capital and earn yield proportional to probability × payout – fees

No claims. No disputes. No paperwork. Automatic settlement within minutes of trigger detection.

Insu sits at the intersection of prediction markets (Polymarket, Kalshi) and traditional insurance — framed as "peace of mind, priced transparently."

---

## 3. Architecture

### Approach: Next.js + Supabase Edge Functions

```
Browser
  └─ Next.js 14 (App Router, SSR + Server Actions)
       ├─ Supabase DB (PostgreSQL) — all data
       ├─ Supabase Auth — user sessions
       ├─ Supabase Realtime — live price/volume updates on browse page
       └─ Supabase Edge Functions (Deno)
            ├─ pricing-engine     — Black-Scholes, runs every 15 min (cron)
            ├─ oracle-poller      — fetches weather/urban data, runs every 5 min (cron)
            ├─ payout-processor   — checks triggers, auto-settles, runs every 5 min (cron)
            ├─ stripe-webhook     — handles Stripe payment confirmations
            └─ conekta-webhook    — handles Conekta payment confirmations
```

### Deployment
- **Frontend:** Vercel
- **Backend:** Supabase Cloud — `https://eagmczieznsogsxldedk.supabase.co`

---

## 4. Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | Next.js 14 (App Router), TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Fonts | Bebas Neue (display) · JetBrains Mono (prices) · Outfit (body) |
| Backend / DB | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password + OAuth) |
| Realtime | Supabase Realtime (contract prices + volume) |
| Edge Functions | Supabase Edge Functions (Deno runtime) |
| Payments — USD | Stripe (cards, international) |
| Payments — MXN | Conekta (cards, OXXO, Mexico) |
| Weather oracle | OpenWeatherMap API + Tomorrow.io API |
| Urban oracle | Waze Routing API (traffic) + manual override |
| Pricing model | Black-Scholes binary cash-or-nothing call option |
| Currency | USD + MXN (auto-detected, user-switchable) |

---

## 5. Database Schema

All tables live in Supabase PostgreSQL. Designed for all 6 sub-projects from day 1.

### `profiles`
Extends `auth.users`. Stores role, currency preference, and payment provider customer IDs.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | FK → auth.users |
| full_name | text | |
| role | enum | `'hedger' \| 'provider' \| 'admin' \| 'both'` |
| preferred_currency | enum | `'USD' \| 'MXN'` |
| stripe_customer_id | text | |
| conekta_customer_id | text | |
| created_at | timestamptz | |

### `categories`
The four top-level browse categories.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | `'Urban' \| 'Nature' \| 'Experiences' \| 'Events'` |
| slug | text UNIQUE | |
| color | text | Hex color for UI theming |
| icon_url | text | |
| display_order | int | |

### `contracts` ⭐
The core entity — each protection contract is a "market."

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| slug | text UNIQUE | URL-safe identifier |
| title | text | e.g. "Power outage in CDMX of more than 2 hours?" |
| description | text | |
| category_id | uuid | FK → categories |
| status | enum | `'active' \| 'settled' \| 'cancelled' \| 'pending'` |
| trigger_type | enum | `'weather' \| 'urban' \| 'event' \| 'manual'` |
| trigger_condition | jsonb | Flexible per trigger type (see below) |
| trigger_deadline | timestamptz | When the trigger window closes |
| location | jsonb | `{lat, lng, city, country}` |
| icon_url | text | |
| total_volume_usd | numeric | Denormalized for browse page performance |
| total_volume_mxn | numeric | |
| is_featured | boolean | |
| settled_outcome | boolean | null until settled |
| created_by | uuid | FK → profiles (admin) |
| created_at | timestamptz | |
| settled_at | timestamptz | |

**trigger_condition examples:**
```json
// weather
{"metric": "rain_mm", "threshold": 10, "duration_days": 3, "operator": "gte"}

// urban
{"type": "power_outage", "min_duration_hours": 2, "source": "manual"}

// temperature
{"metric": "temp_c", "threshold": 35, "duration_days": 3, "operator": "gte"}
```

### `coverage_tiers` ⭐
Basic and Premium tiers per contract. Prices are recalculated by the Black-Scholes engine.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| contract_id | uuid | FK → contracts |
| name | enum | `'basic' \| 'premium'` |
| premium_usd | numeric | What hedger pays (BS output) |
| payout_usd | numeric | What hedger receives if trigger |
| premium_mxn | numeric | |
| payout_mxn | numeric | |
| max_capacity_usd | numeric | Capital ceiling for this tier |
| current_capacity_usd | numeric | How much is currently backed |
| last_priced_at | timestamptz | |
| pricing_inputs | jsonb | Snapshot of BS inputs used |

### `hedger_positions`
A buyer's purchased protection contract.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid | FK → profiles |
| contract_id | uuid | FK → contracts |
| tier_id | uuid | FK → coverage_tiers |
| premium_paid_usd | numeric | |
| payout_amount_usd | numeric | |
| premium_paid_mxn | numeric | |
| payout_amount_mxn | numeric | |
| currency | enum | `'USD' \| 'MXN'` |
| payment_provider | enum | `'stripe' \| 'conekta'` |
| payment_intent_id | text | Stripe PaymentIntent or Conekta Order ID |
| status | enum | `'pending_payment' \| 'active' \| 'paid_out' \| 'expired' \| 'cancelled'` |
| purchased_at | timestamptz | |
| expires_at | timestamptz | = trigger_deadline |

### `provider_positions`
A risk provider's capital deposit into a contract pool.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid | FK → profiles |
| contract_id | uuid | FK → contracts |
| tier_id | uuid | FK → coverage_tiers |
| capital_deposited_usd | numeric | |
| capital_deposited_mxn | numeric | |
| currency | enum | `'USD' \| 'MXN'` |
| payment_provider | enum | `'stripe' \| 'conekta'` |
| payment_intent_id | text | |
| expected_return_usd | numeric | Calculated at deposit: P(event) × payout – fee |
| actual_return_usd | numeric | Filled at settlement |
| expected_return_mxn | numeric | |
| actual_return_mxn | numeric | |
| status | enum | `'pending_payment' \| 'active' \| 'settled' \| 'cancelled'` |
| deposited_at | timestamptz | |
| settled_at | timestamptz | |

### `oracle_readings`
Raw data ingested from external APIs.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| contract_id | uuid | FK → contracts |
| source | enum | `'openweathermap' \| 'tomorrow_io' \| 'waze' \| 'manual'` |
| reading_type | text | `'rain_mm' \| 'temp_c' \| 'traffic_index' \| 'power_outage'` |
| value | jsonb | Raw API response snapshot |
| trigger_met | boolean | Whether this reading satisfies the trigger condition |
| read_at | timestamptz | |

### `payouts`
Automatic settlement records.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| contract_id | uuid | FK → contracts |
| hedger_position_id | uuid | FK → hedger_positions |
| amount_usd | numeric | |
| amount_mxn | numeric | |
| currency | enum | `'USD' \| 'MXN'` |
| payment_provider | enum | `'stripe' \| 'conekta'` |
| transfer_id | text | Stripe Transfer or Conekta transfer ID |
| status | enum | `'pending' \| 'processing' \| 'completed' \| 'failed'` |
| created_at | timestamptz | |
| completed_at | timestamptz | |

### `pricing_history`
Audit trail for every Black-Scholes run.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| contract_id | uuid | FK → contracts |
| tier_id | uuid | FK → coverage_tiers |
| bs_inputs | jsonb | `{S, K, T, sigma, r}` |
| bs_output | jsonb | `{price, N_d2, delta}` |
| premium_usd_before | numeric | |
| premium_usd_after | numeric | |
| calculated_at | timestamptz | |

---

## 6. Black-Scholes Pricing

Parametric contracts are treated as **binary cash-or-nothing call options**.

**Variable mapping:**

| BS Variable | Insu Meaning |
|---|---|
| S (spot) | Current probability of event (0–1). Admin sets initial `base_probability` per tier (stored in `coverage_tiers`). Oracle poller adjusts S daily within ±20% of base based on recent readings trend. |
| K (strike) | 1.0 — normalized; event is binary (happens or not) |
| T (time) | Days until `trigger_deadline` / 365 |
| σ (volatility) | Rolling 90-day std dev of daily event probability from historical readings |
| r (risk-free rate) | SOFR (~5% annualized) |

**Formula (binary cash-or-nothing call):**

```
d2 = [ln(S/K) + (r - σ²/2) × T] / (σ × √T)
Fair Premium = e^(-rT) × N(d2) × Payout
Insu Premium = Fair Premium × (1 + fee_spread)   // fee_spread = 0.07–0.10
```

**Recalculation:** Edge Function cron every 15 minutes. Writes new `premium_usd/mxn` to `coverage_tiers` and appends a row to `pricing_history`.

---

## 7. Oracle Integrations

| Trigger Type | Source | Poll Frequency | Trigger Check |
|---|---|---|---|
| Weather (rain, temp, snow) | OpenWeatherMap + Tomorrow.io | Every 5 min | Compare reading against `trigger_condition` threshold |
| Traffic (Waze) | Waze Routing API | Every 5 min | Traffic index above threshold |
| Power/urban outage | Manual override (admin) | On-demand | Admin sets `trigger_met = true` |
| Event cancellation | Manual override (admin) | On-demand | Admin sets `trigger_met = true` |

**Payout trigger:** When `oracle_readings.trigger_met = true` for a contract, the payout processor Edge Function:
1. Marks `contracts.settled_outcome = true`
2. Iterates all `hedger_positions` with `status = 'active'`
3. Creates a `payouts` row per position
4. Initiates Stripe Transfer or Conekta transfer
5. Updates `hedger_positions.status = 'paid_out'`
6. Settles `provider_positions` (capital returned minus loss)

---

## 8. Payment Flows

### Hedger buys protection
1. User selects contract + tier → clicks "Buy now"
2. Server Action creates a Stripe PaymentIntent (USD) or Conekta Order (MXN)
3. Inserts `hedger_positions` row with `status = 'pending_payment'`
4. User completes checkout (Stripe Elements or Conekta checkout)
5. Webhook Edge Function receives payment confirmation
6. Updates `hedger_positions.status = 'active'`
7. Updates `coverage_tiers.current_capacity_usd` and `contracts.total_volume_usd`

### Risk provider deposits capital
1. Provider selects contract + tier + deposit amount → clicks "Provide capital"
2. Same payment flow as above but writes to `provider_positions`
3. On confirmation: updates `risk_pools` available capital

### Automatic payout
1. Payout processor detects trigger
2. Stripe: credits the payout amount to the user's **Stripe Customer Balance** (no Stripe Connect needed in v1); user can then withdraw or apply to future purchases
3. Conekta: credits via Conekta Customer Balance or initiates SPEI transfer (Mexico bank transfer)
4. Updates `payouts.status = 'completed'`
5. Note: Full Stripe Connect (direct bank payouts) is a v2 upgrade once the platform is licensed

---

## 9. Pages & Routes

| Route | Description | Auth |
|---|---|---|
| `/` | Browse marketplace — categories + contract cards + live volume | Public |
| `/markets/[slug]` | Contract detail — price chart, oracle data, buy/provide buttons | Public |
| `/buy/[slug]` | Hedger purchase flow — tier selection, amount, payment | Required |
| `/provide/[slug]` | Risk provider capital deposit flow | Required |
| `/dashboard` | Portfolio — active protections, provider positions, payout history | Required |
| `/dashboard/protections` | Hedger view — active + expired protections | Required |
| `/dashboard/positions` | Provider view — capital deployed, expected/actual returns | Required |
| `/auth/login` | Login (email + OAuth) | Public |
| `/auth/signup` | Sign up | Public |
| `/admin` | Admin panel — contract CRUD, trigger override | Admin only |
| `/admin/contracts/new` | Create new protection contract | Admin only |
| `/admin/contracts/[id]` | Edit contract, set manual trigger | Admin only |
| `/admin/oracles` | Oracle readings monitor | Admin only |
| `/admin/payouts` | Payout queue and history | Admin only |

---

## 10. UI Design

### Visual Identity
- **Theme:** Dark editorial-financial (deep navy `#080c18`)
- **Display font:** Bebas Neue (logo, category headers)
- **Mono font:** JetBrains Mono (all prices, volumes, dates)
- **Body font:** Outfit (navigation, descriptions, buttons)
- **Accent color:** Amber `#f5a623`
- **Category colors:** Urban `#94a3b8` · Nature `#34d399` · Experiences `#fb923c` · Events `#a78bfa`
- **Payout values:** Always green `#22c55e`

### Browse Page Card Structure
```
┌─ [category color top stripe] ──────────────────┐
│ [ICON]                              [badge?]   │
│ Contract title question text here              │
│ ─────────────────────────────────────────────  │
│ Label / date           $PREMIUM / $PAYOUT      │
│ Label / date           $PREMIUM / $PAYOUT      │
│ ─────────────────────────────────────────────  │
│ ● $Xm Vol.                      [Buy now]      │
└────────────────────────────────────────────────┘
```
$PREMIUM in white, $PAYOUT always in green. Hover = lift + category glow.

---

## 11. Sub-Project Breakdown

| # | Sub-Project | Key Deliverables |
|---|---|---|
| 1 | **Foundation + Marketplace Browse** | DB schema, Supabase setup, auth, browse page with all 4 category sections, live Realtime updates |
| 2 | **Contract Detail + Purchase Flows** | `/markets/[slug]` detail page, hedger buy flow, risk provider deposit flow, Stripe + Conekta integration |
| 3 | **Pricing Engine** | Black-Scholes Edge Function, 15-min cron, pricing_history audit trail, live price updates via Realtime |
| 4 | **Oracle Integrations + Auto-Payouts** | OpenWeatherMap, Tomorrow.io, Waze polling, trigger detection, automatic payout processing |
| 5 | **Portfolio Dashboard** | `/dashboard` with hedger protections view, provider positions view, payout history, P&L |
| 6 | **Admin Panel** | Contract CRUD, manual trigger override, oracle monitor, payout queue management |

**Build order:** 1 → 2 → 3 → 4 → 5 → 6. Each sub-project is independently deployable.

---

## 12. Key Constraints & Decisions

- **No blockchain.** Traditional web app with fiat payments only.
- **Supabase is the single backend.** No separate microservices beyond Edge Functions.
- **Black-Scholes for all pricing.** Manual admin price override available as fallback.
- **MXN exchange rate.** USD/MXN rate fetched daily from `open.er-api.com` (free, no auth required) and stored in a `config` table; premiums in MXN are `premium_usd × rate`.
- **Capacity limits.** A coverage tier cannot sell more hedger protection than its `max_capacity_usd` (enforced at checkout).
- **No secondary market.** Positions cannot be resold (unlike Polymarket). Buy-and-hold only.
- **Row-level security.** All Supabase tables use RLS. Users can only read/write their own positions.
