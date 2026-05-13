# Insu SP2 — Contract Detail + Purchase Flows

**Date:** 2026-05-12
**Status:** Approved for implementation
**Depends on:** SP1 (Foundation + Marketplace Browse)

---

## 1. Goal

Build the contract detail page (`/markets/[slug]`) and both purchase flows (hedger buy + risk provider deposit) as a slide-over panel on that page. Integrate Stripe for payment processing. No new DB tables required — all tables were created in SP1.

---

## 2. Scope

**In scope:**
- `/markets/[slug]` contract detail page
- Slide-over purchase panel (buy + provide modes, single panel with toggle)
- Stripe Elements embedded payment form
- Server Actions to create Stripe `PaymentIntent`
- Stripe webhook Edge Function (`payment_intent.succeeded`)
- Price history chart (Tremor `AreaChart`, seeded with current tier prices)
- Inline auth gate in panel for unauthenticated users

**Out of scope for SP2:**
- Conekta (MXN payments) — deferred to a later sprint
- `/buy/[slug]` and `/provide/[slug]` dedicated routes — not needed; panel is on detail page
- Price history populated by the pricing engine — that's SP3; chart renders what exists in DB

---

## 3. Pages & Routes

| Route | Component type | Description |
|---|---|---|
| `/markets/[slug]` | Server component | Fetches contract + tiers, renders detail page |
| `/markets/[slug]/loading.tsx` | Next.js loading | Skeleton while server component fetches |

No new auth routes. Auth redirect target is `/auth/login?next=/markets/[slug]`.

---

## 4. Layout

### Contract Detail Page — Left/Right Split

```
┌─────────────────────────────────────────────────────────┐
│ Header (existing)                                        │
├──────────────────────────────┬──────────────────────────┤
│ LEFT COLUMN                  │ RIGHT COLUMN (sticky)    │
│                              │                          │
│  [Category badge · Title]    │  SELECT TIER             │
│  [Description]               │  ┌──────────────────┐   │
│                              │  │ Basic  $12 → $500 │   │
│  [Price Chart — Tremor]      │  └──────────────────┘   │
│                              │  ┌──────────────────┐   │
│  [Contract Meta]             │  │ Premium $38→$2000 │   │
│   · Trigger type + condition │  └──────────────────┘   │
│   · Trigger deadline         │                          │
│   · Location                 │  [Buy Protection]        │
│   · Oracle source            │  [Provide Capital]       │
│   · Total volume             │                          │
└──────────────────────────────┴──────────────────────────┘
```

Right column is `position: sticky; top: header-height` so action buttons stay in view as user scrolls.

### Slide-Over Panel

Slides in from the right over the detail page (backdrop overlay). Single panel with Buy/Provide mode toggle at top.

```
┌────────────────────────────────────┐
│ [Contract title]              [✕]  │
│ ┌──────────────┬───────────────┐   │
│ │ Buy Protection│ Provide Capital   │
│ └──────────────┴───────────────┘   │
│                                    │
│ SELECT TIER                        │
│ ┌──────────────────────────────┐   │
│ │ Basic · $12 premium          │   │
│ │         $500 payout          │   │
│ └──────────────────────────────┘   │
│ ┌──────────────────────────────┐   │
│ │ Premium · $38 premium   ✓   │   │
│ │          $2,000 payout       │   │
│ └──────────────────────────────┘   │
│                                    │
│ [Stripe Elements card form]        │
│                                    │
│ [Pay $38]                          │
└────────────────────────────────────┘
```

**Provide mode** shows the same tier cards (displaying remaining capacity instead of payout) plus a deposit amount input below (min: $10, max: remaining tier capacity). Same Stripe Elements form below.

**Auth gate** (unauthenticated): replaces tier selection + payment form with:
```
Sign in to buy protection or provide capital.
[Sign in]   (links to /auth/login?next=/markets/[slug])
```

**Confirmation screen** (post-payment): replaces the form with a success message showing payout amount (buy) or deposit amount confirmed (provide).

---

## 5. Components

```
app/
  markets/[slug]/
    page.tsx              Server component — fetches contract with tiers + category
    loading.tsx           Skeleton (left/right columns)
components/
  markets/
    ContractDetailClient.tsx   Client — panel open/close state, active mode (buy/provide)
    PriceChart.tsx             Tremor AreaChart — pricing history (premium_usd over time)
    ContractMeta.tsx           Trigger condition, deadline, location, oracle source, volume
    TierSelector.tsx           Tier cards — used in both right column and panel
    PurchasePanel.tsx          Slide-over shell — renders AuthGate or buy/provide form
    AuthGate.tsx               Inline sign-in prompt for unauthenticated users
    StripePaymentForm.tsx      Stripe Elements — confirms PaymentIntent client-side
lib/
  actions/
    purchase.ts               Server Actions: createHedgerPaymentIntent, createProviderPaymentIntent
supabase/
  functions/
    stripe-webhook/
      index.ts                Edge Function — handles payment_intent.succeeded
```

---

## 6. Data Flow

### Hedger Buy Flow

1. User selects a tier in the right column or panel → clicks "Buy Protection"
2. Panel opens (or is already open) with buy mode active and tier pre-selected
3. User confirms tier + Stripe card form loads
4. On submit → `createHedgerPaymentIntent(tierId)` Server Action:
   - Reads `coverage_tiers` — rejects if `current_capacity_usd >= max_capacity_usd`
   - Inserts `hedger_positions` row: `{ tier_id, user_id, status: 'pending_payment', premium_usd }`
   - Creates Stripe `PaymentIntent` with `metadata: { position_type: 'hedger', position_id }`
   - Returns `{ clientSecret }`
5. `StripePaymentForm` calls `stripe.confirmCardPayment(clientSecret)`
6. On success → panel shows confirmation screen

### Risk Provider Deposit Flow

1. User clicks "Provide Capital" → panel opens in provide mode
2. User selects tier + enters deposit amount (USD)
3. On submit → `createProviderPaymentIntent(tierId, amountUsd)` Server Action:
   - Validates `amountUsd > 0` and remaining tier capacity
   - Inserts `provider_positions` row: `{ tier_id, user_id, status: 'pending_payment', amount_usd }`
   - Creates Stripe `PaymentIntent` with `metadata: { position_type: 'provider', position_id }`
   - Returns `{ clientSecret }`
4. Same `StripePaymentForm` confirms payment
5. On success → confirmation screen

### Stripe Webhook

Edge Function at `supabase/functions/stripe-webhook/index.ts`:
- Verifies Stripe webhook signature (`STRIPE_WEBHOOK_SECRET`)
- On `payment_intent.succeeded`:
  - Reads `metadata.position_type` and `metadata.position_id`
  - Updates position `status → 'active'`
  - **Hedger:** increments `coverage_tiers.current_capacity_usd` by `premium_usd`; increments `contracts.total_volume_usd`
  - **Provider:** increments `risk_pools.available_capital_usd` by `amount_usd`

---

## 7. Price Chart

`PriceChart.tsx` uses Tremor `AreaChart`. Data source: `pricing_history` table joined to the contract's tiers. In SP2, this table will contain at most one data point per tier (seeded by SP1). The component renders whatever rows exist — chart grows richer once SP3's pricing engine starts writing history.

X-axis: `priced_at` timestamp. Y-axis: `premium_usd`. One series per tier (Basic, Premium), colored by tier.

---

## 8. New Environment Variables

```
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Add all three to `.env.local.example`.

---

## 9. Testing

**Unit tests (Vitest):**
- `ContractMeta` — renders trigger condition, deadline, location
- `TierSelector` — highlights selected tier, calls onSelect
- `AuthGate` — renders sign-in link with correct `next` param
- `PurchasePanel` — toggles between buy/provide mode; shows AuthGate when unauthenticated

**E2E (Playwright):**
- Smoke test: visit `/markets/[slug]`, verify detail page renders with chart and tier cards
- Panel opens on "Buy Protection" click; shows auth gate when logged out

**No Stripe payment flow in automated tests** — Stripe Elements requires a browser with network access to Stripe JS; test the confirmation screen with a mocked `clientSecret`.
