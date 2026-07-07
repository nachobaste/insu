# Browse cleanup: live products vs Coming Soon

**Date:** 2026-07-06
**Status:** Approved (brainstorming session with Gerardo)

## Problem

The browse page mixes 17 genuinely purchasable products (working oracle + live
derivative pricing) with ~25 demo contracts that resolve manually, have no
oracle, or have already-passed deadlines. New users can't tell what actually
works. Goal: new users see only coverage that works and is priced (traffic,
gas, flood, plus air quality), with everything else in a clearly separated
Coming Soon section. Applies identically to the Mexico and International
regions.

## Current inventory (prod, 2026-07-06)

**Live (17):** 12 CDMX traffic corridors + 2 Guatemala City corridors (Google
Maps oracle), gas-price-magna-cdmx (CRE oracle), flood-heavy-rain-cdmx (OWM),
air-quality-contingencia-cdmx (OWM).

**Coming Soon, curated (~9 evergreen):** caribbean-hurricane-landfall,
guadalajara-flash-flood, cabo-heatwave, whistler-snow-20cm, amazon-flood-alert,
sao-paulo-metro-shutdown, gas-price-guatemala-q45, bogota-water-shortage,
buenos-aires-blackout. (São Paulo metro is `urban`-typed but has zero oracle
readings; Guatemala gas is `manual` — no GT fuel oracle exists yet.)

**Cancel (expired/dated demos):** earthquakes-7-june-30, cdmx-marathon-rain,
oaxaca-food-festival, bad-bunny-cancelled, karol-g-medellin-cancelled,
lollapalooza-bsas-cancelled, monterrey-tech-summit, carnaval-rio-shortened,
patagonia-trail-closed, cancun-beach-closure, and the stray pending contract
diablos-rojos-vs-tigres-de-quintana-roo-mp99hwh4.
Final keep/cancel split for borderline evergreen items (e.g. cancun-beach-closure,
patagonia-trail-closed) is decided at implementation time; target is 8–10
believable, undated Coming Soon products. **Guard: verify no active positions
exist on a contract before cancelling it.**

## Design

### 1. Data model: explicit `launch_stage`

- `contracts.launch_stage text NOT NULL DEFAULT 'live' CHECK (launch_stage IN ('live','coming_soon'))`.
- Chosen over a derived rule (trigger_type ∈ {urban, fuel, flood, air_quality})
  because São Paulo metro would be misclassified as live, and flipping a
  product live (e.g. Guatemala gas when the AGN oracle ships) should be a row
  update, not a deploy.
- Backfill migration sets the 17 live products to `live`, the curated set to
  `coming_soon`, and cancels the expired demos (status = 'cancelled').
- Admin `ContractForm` gets a launch-stage field so curation stays in the UI.

### 2. Browse page (both regions, same structure)

Two-zone layout (selected as Option A over a segmented Available/Coming-soon
toggle and over inline badges in the existing category sections):

- **Zone 1 — Available now**, grouped by product type instead of the old
  Urban/Nature/Experiences/Events categories:
  - **Traffic protection** — corridor pair cards grouped by city (Mexico City;
    Guatemala City in the International view).
  - **Gas** — fuel price contracts.
  - **Flood & Air quality** — the OWM-backed products.
- **Zone 2 — Coming Soon rail** at the bottom: dimmed cards with a badge, no
  premium/price shown (pricing isn't real for these).
- `CategoryTabs` is removed from the browse page (redundant at this catalog
  size). Search stays; results may include coming-soon items, badged.
- Trending section and StatsBar compute over `launch_stage = 'live'` contracts
  only.
- Region behavior unchanged: `RegionToggle` + `filterByRegion` still split
  MX vs International; both regions render the same two-zone structure.

### 3. Coming Soon detail page + notify-me

- Detail pages stay browsable (map, story, evidence where readings exist).
- `PurchasePanel` is replaced by a **ComingSoonPanel**: short copy that the
  coverage isn't live yet + "Notify me when it launches" button.
  - Signed-out users see a sign-in CTA instead.
- Interest stored in new table `launch_interest (user_id, contract_id,
  created_at, UNIQUE(user_id, contract_id))` with owner-scoped RLS.
- When a contract flips `coming_soon → live`, interested users get an in-app
  notification: new `product_launched` NotificationType routed through the
  existing `createNotification` (prefs-aware; also inherits the planned email
  channel automatically). Flip mechanism: admin form update triggers the
  notification fan-out server-side.

### 4. Out of scope / unchanged

- Purchase flow, payout processor, dashboard, portfolio, existing positions.
- No email sending (separate, already-scoped project; this design only adds
  the `product_launched` notification type it will reuse).
- No new Coming Soon products; curation only re-labels existing contracts.

## Testing

- Unit: live/coming-soon partition + product-type grouping helpers; trending
  and stats exclude coming-soon; notify-me insert is idempotent (unique key).
- E2E smoke: browse (MX + International) shows product sections and the
  Coming Soon rail; coming-soon detail hides the purchase panel and shows the
  notify block; live detail is unchanged.
- Migration check: cancelled demos have no active positions; contract counts
  per stage match the inventory above.
