# Spec: Trending Banner + Seed Contracts

**Date:** 2026-05-17
**Status:** Approved

---

## Overview

Two independent changes to make the browse page feel like a live marketplace:

1. **Seed contracts** — add ~12 new contracts across all 4 categories, covering Latin American cities.
2. **Trending banner** — a "Featured Row" section that appears between the existing `StatsBar` and the regular contract sections, showing the top 4 trending contracts.

---

## 1. Seed Contracts

### Goal
Populate all 4 categories with enough contracts that the browse page feels full and varied. Currently there are 5 contracts; the target is ~17 total (~4–5 per category).

### New contracts

**Urban** (city infrastructure events)
| Slug | Title | City |
|---|---|---|
| `cdmx-air-quality-alert` | Air quality emergency in CDMX? | CDMX, MX |
| `sao-paulo-metro-shutdown` | São Paulo metro line shutdown during rush hour? | São Paulo, BR |
| `bogota-water-shortage` | Water supply cut in Bogotá lasting 6+ hours? | Bogotá, CO |
| `buenos-aires-blackout` | Major blackout in Buenos Aires? | Buenos Aires, AR |

**Nature** (environmental / climate events)
| Slug | Title | City |
|---|---|---|
| `popocatepetl-eruption-alert` | Popocatépetl eruption alert issued? | CDMX, MX |
| `caribbean-hurricane-landfall` | Category 3+ hurricane landfall on Mexican Caribbean coast? | Cancún, MX |
| `amazon-flood-alert` | Amazon River flood alert in Manaus? | Manaus, BR |
| `northern-mexico-drought` | Drought emergency declared in northern Mexico? | Monterrey, MX |

**Experiences** (travel / leisure disruption)
| Slug | Title | City |
|---|---|---|
| `cancun-beach-closure` | Cancún beach closure due to sargassum? | Cancún, MX |
| `carnaval-rio-shortened` | Rio Carnaval shortened or cancelled? | Rio de Janeiro, BR |
| `patagonia-trail-closed` | Torres del Paine main trail closed? | Punta Arenas, CL |

**Events** (concerts, sports, cultural)
| Slug | Title | City |
|---|---|---|
| `karol-g-medellin-cancelled` | Karol G concert in Medellín cancelled? | Medellín, CO |
| `lollapalooza-bsas-cancelled` | Lollapalooza Argentina cancelled or postponed? | Buenos Aires, AR |

### Seed mechanics
- Added to `scripts/seed-contracts.ts` alongside existing contracts
- Each contract gets basic + premium tiers
- `total_volume_usd` varied across contracts ($80K–$9M) to produce realistic volume distribution
- `is_featured` set to `false` on all new contracts (trending logic handles prominence)
- `trigger_deadline` set to plausible future dates

---

## 2. Trending Banner

### Goal
Show the 4 most trending contracts in a compact Featured Row directly below `StatsBar`, above the regular category sections. The `StatsBar` component is not modified.

### Trending score (frontend, no DB changes)

Computed in `BrowseClient.tsx` from the already-loaded `contracts` array:

```
score = total_volume_usd × recency_weight

recency_weight:
  1.0  if created_at is within the last 60 days
  0.5  otherwise
```

Take the top 4 by score. If fewer than 2 contracts qualify, the section is hidden.

### New component: `TrendingSection`

File: `components/contracts/TrendingSection.tsx`

**Props:**
```ts
interface Props {
  contracts: ContractWithTiers[]  // pre-filtered top 4
  currency: Currency
}
```

**Visual design (matches mockup):**
- Section header: "🔥 Trending Now" label + "LIVE" badge (orange, pulsing)
- 4-column grid of compact cards
- Each card uses the category color for: top border (2px), icon background tint, price text, category pill
- Card content: category emoji icon, contract title, "from $X" price (cheapest tier), category name pill
- Cards are clickable — navigate to `/markets/[slug]`
- Below the section, a small "All contracts" label divides it from the regular sections
- No changes to `ContractCard` or `ContractSection` components

### BrowseClient changes

- Compute `trendingContracts` from `contracts` using the scoring formula above
- Render `<TrendingSection>` between `<StatsBar>` and the category map
- `TrendingSection` is hidden when `trendingContracts.length < 2`

### No DB migrations required
The scoring is pure JavaScript. No new columns, no new queries, no schema changes.

---

## Files changed

| File | Change |
|---|---|
| `scripts/seed-contracts.ts` | Add ~12 new contracts |
| `components/contracts/TrendingSection.tsx` | New component |
| `app/BrowseClient.tsx` | Add scoring logic + render `TrendingSection` |

---

## Out of scope

- Admin controls for pinning/unpinning trending contracts
- Sorting or filtering the trending row
- Persisting the trending score in the DB
- Any changes to `StatsBar`, `ContractCard`, or `ContractSection`
