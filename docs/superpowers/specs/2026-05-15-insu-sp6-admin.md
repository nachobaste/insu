# SP6: Admin Panel — Design Spec

**Date:** 2026-05-15
**Status:** Approved for implementation

---

## 1. Goal

Give admins a single authenticated area to manage contracts, manually override triggers, monitor oracle readings, and retry stuck payouts — without touching the database directly.

---

## 2. Access Control

Any user with `role = 'admin'` in the `profiles` table gets access. The check lives in `app/admin/layout.tsx` — reads session, joins profile, redirects to `/` if role is not `'admin'`. No env secret required; the Supabase RLS + server-only role check is sufficient for v1.

---

## 3. Route Structure

```
app/
  admin/
    layout.tsx              ← role check + AdminSidebar shell (Server Component)
    contracts/
      page.tsx              ← contract list
      new/
        page.tsx            ← create form
      [id]/
        page.tsx            ← edit form
    trigger/
      page.tsx              ← manual override form
    oracle/
      page.tsx              ← oracle monitor (master/detail)
    payouts/
      page.tsx              ← payout queue + retry

components/
  admin/
    AdminSidebar.tsx        ← "use client" for usePathname active-link highlight
    contracts/
      ContractList.tsx
      ContractForm.tsx      ← shared create/edit form
    trigger/
      TriggerOverride.tsx   ← "use client"
    oracle/
      OracleMonitor.tsx     ← "use client" (click-to-select contract)
    payouts/
      PayoutQueue.tsx       ← "use client" (filter tabs + retry)

lib/
  actions/
    admin.ts                ← NEW: all admin server actions
```

`layout.tsx` renders `<AdminSidebar />` in a persistent left rail alongside `{children}`. The sidebar uses `usePathname()` to highlight the active link — thin client wrapper, server-rendered shell.

---

## 4. Sidebar Navigation

Four links, always visible:

| Label | Route | Icon |
|---|---|---|
| Contracts | `/admin/contracts` | 📋 |
| Trigger | `/admin/trigger` | ⚡ |
| Oracle | `/admin/oracle` | 🌐 |
| Payouts | `/admin/payouts` | 💸 |

Header shows "ADMIN" in amber `#f5a623`. Active link has a highlighted background. Visual design follows the existing dark design system (`#080c18` background, `#111827` cards, `#1c2333` borders).

---

## 5. Contracts Section

### List — `/admin/contracts`

Server Component. Fetches all contracts (all statuses) with `category` join. Renders `ContractList` with a **+ New Contract** button linking to `/admin/contracts/new`.

Table columns: Title + deadline, Category, Trigger type, Status badge, Edit link.

Status badges: `active` (green), `pending` (amber), `settled` / `cancelled` (grey, 60% opacity row).

### Create/Edit — `/admin/contracts/new` and `/admin/contracts/[id]`

Server Components. Edit page fetches the contract + its two coverage tiers. Both render `ContractForm` — a single shared client component.

**`ContractForm` fields:**

| Field | Input type |
|---|---|
| Title | text |
| Description | textarea |
| Category | select (Urban / Nature / Experiences / Events) |
| Status | select (active / pending / settled / cancelled) |
| Trigger type | select — drives the Trigger Condition block |
| Trigger deadline | date |
| Location (city, country, lat, lng) | four text inputs |
| Icon URL | text |
| Is featured | checkbox |

**Trigger Condition block** — fields swap based on trigger type:

| Trigger type | Fields shown |
|---|---|
| `weather` | Metric (rainfall / temperature / wind / snow) · Comparator (> / < / =) · Threshold (number + unit) |
| `urban` | Metric (delay / congestion) · Comparator (> / <) · Threshold (number + unit) |
| `event` | Description (text) — free-form condition for manual evaluation |
| `manual` | No fields — oracle is driven entirely by admin override |

The block renders the structured fields and serialises them to a `trigger_condition` JSON object on save.

**Coverage Tiers block** — always basic + premium, two editable rows:

| Column | Input |
|---|---|
| Premium USD | number |
| Payout USD | number |
| Max capacity USD | number |

MXN values are derived server-side from the USD/MXN rate in the `config` table — not editable in the form.

**Save action** calls `upsertContract(formData)` in `lib/actions/admin.ts`. On success, redirects to `/admin/contracts`. Validation: all required fields present, deadline is a future date, payout USD > premium USD.

---

## 6. Trigger Override Section

### `/admin/trigger`

Client component (`TriggerOverride`). Server Component page pre-fetches all active contracts for the selector.

**Flow:**

1. Admin selects a contract from a dropdown. Page loads a summary card showing: trigger type, active hedger count, total payout exposure (sum of `payout_amount_usd`), oracle status + last reading value.
2. Admin picks outcome — two cards:
   - **TRIGGER FIRED** (`settled_outcome = true`) — hedgers receive payouts, providers absorb loss share
   - **NO TRIGGER** (`settled_outcome = false`) — no payouts, providers keep yield
3. Admin fills a required **Reason** text field (written to `admin_audit_log.reason`).
4. Confirm button — label reflects chosen outcome: `CONFIRM OVERRIDE — TRIGGER FIRED` or `CONFIRM OVERRIDE — NO TRIGGER`. Button is red (`#ef4444`) to signal irreversibility.

**On confirm**, calls `overrideContractTrigger({ contractId, outcome, reason })` in `lib/actions/admin.ts`. The action:
1. Sets `contracts.settled_outcome = outcome` and `contracts.status = 'settled'` and `contracts.settled_at = now()`
2. Inserts a row into a new `admin_audit_log` table (see section 9) with `action = 'trigger_override'`, `reason`, `admin_id`, `contract_id`
3. If `outcome = true`, fetches all active hedger positions for this contract and calls `payoutPosition()` for each

After success, shows a confirmation toast and resets the form.

---

## 7. Oracle Monitor Section

### `/admin/oracle`

Client component (`OracleMonitor`). Server Component page pre-fetches all active contracts + their most recent oracle reading each.

**Layout: master/detail panel**

**Left panel** — vertical list of contract cards, one per active contract. Each card shows:
- Contract title
- Trigger badge: `NO TRIGGER` (grey), `⚡ TRIGGERED` (red), `⚠ STALE` (amber — last reading > 10 min ago)
- Source (OpenWeatherMap / Tomorrow.io / Waze / Manual)
- Last read timestamp
- Current value (parsed scalar, e.g. `12.0 mm`)
- Threshold (e.g. `> 25 mm`)

Clicking a card loads the detail panel. Selected card highlighted in amber border.

**Right panel** — detail for the selected contract:
- Header: contract title, source, trigger condition string, deadline
- **Bar chart** — last 9 readings as vertical bars, dashed horizontal threshold line, current value labelled
- **Reading log table** — columns: Time, Raw value (JSON snippet), Parsed scalar, Trigger (YES/NO). Most recent first. Last 20 readings.

Stale contracts (no reading in 10+ min) show amber border in the list and amber timestamp in the detail header.

---

## 8. Payout Queue Section

### `/admin/payouts`

Client component (`PayoutQueue`). Server Component page pre-fetches all payouts joined with `hedger_positions → profiles.full_name` and `contracts.title`.

**Stats strip** — four headline numbers: Total, Completed, Processing, Volume (sum of all payout amounts).

**Filter tabs** — All · Processing (N) · Completed. Default: All.

**Table columns:** User full name / Contract title · Stripe transfer ID · Amount · Created · Status badge · Action

- `processing` rows: amber border, **Retry** button
- `completed` rows: grey, 65% opacity, Stripe transfer ID visible, no action button

**Retry action** calls `retryPayout(payoutId)` in `lib/actions/admin.ts`. The action calls the existing `payoutPosition()` logic scoped to that single payout record. On success, updates the row status in-place (no full reload). On failure, shows an error toast with the Stripe error message.

---

## 9. Schema Addition

One new table: `admin_audit_log` — records irreversible admin actions.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| admin_id | uuid | FK → auth.users |
| action | text | e.g. `'trigger_override'` |
| contract_id | uuid | nullable, FK → contracts |
| payout_id | uuid | nullable, FK → payouts |
| reason | text | required for trigger overrides |
| metadata | jsonb | outcome, previous status, etc. |
| created_at | timestamptz | |

RLS: admins can insert, read their own rows. No updates or deletes.

---

## 10. `lib/actions/admin.ts`

Four server actions, all using the Supabase service-role client:

| Action | What it does |
|---|---|
| `upsertContract(data)` | Insert or update contract + two coverage tiers |
| `overrideContractTrigger({ contractId, outcome, reason })` | Settle contract, log to audit table, call `payoutPosition()` per hedger if outcome = true |
| `retryPayout(payoutId)` | Re-run `payoutPosition()` for one payout record |

All actions validate that the calling user has `role = 'admin'` before executing — defence in depth on top of the layout guard.

---

## 11. Visual Design

Follows the established design system:

- **Background:** `#080c18`
- **Card background:** `#111827`, border `#1c2333`
- **Admin accent / CTA:** `#f5a623` (amber)
- **Active / completed:** `#22c55e`
- **Processing / stale:** `#f5a623`
- **Triggered / danger:** `#ef4444`
- **Muted text:** `#8b949e`
- **Fonts:** Bebas Neue (page label) · JetBrains Mono (numbers, amounts) · Outfit (labels, body)

---

## 12. Testing

**One new test file:** `tests/lib/actions/admin.test.ts`

Tests use a mocked Supabase service-role client (same pattern as existing action tests):

| Test | Assertion |
|---|---|
| `upsertContract` — create path | Inserts contract row + two tier rows, returns new contract id |
| `upsertContract` — edit path | Updates existing contract and tiers, no duplicate rows |
| `upsertContract` — validation | Rejects if deadline is in the past or payout < premium |
| `overrideContractTrigger` — trigger fired | Sets `settled_outcome = true`, calls `processPayouts`, inserts audit log row |
| `overrideContractTrigger` — no trigger | Sets `settled_outcome = false`, does NOT call `processPayouts`, inserts audit log row |
| `overrideContractTrigger` — auth guard | Throws if calling user is not admin |
| `retryPayout` — success | Calls `payoutPosition` with the correct payout record |
| `retryPayout` — not found | Throws if payout ID does not exist |

No component tests. Oracle monitor and payout queue client interactivity is too thin to warrant unit tests. Visual correctness verified by running the dev server.

---

## 13. Spec Coverage

| Design requirement | Implementation |
|---|---|
| Role-gated `/admin` area | `layout.tsx` role check → redirect |
| Sidebar with 4 sections | `AdminSidebar.tsx`, `usePathname` active highlight |
| Contract list (all statuses) | `app/admin/contracts/page.tsx` + `ContractList.tsx` |
| Contract create/edit | `app/admin/contracts/new` + `[id]` + shared `ContractForm.tsx` |
| Structured trigger condition fields | Per-type field sets in `ContractForm`, serialised to JSON |
| Coverage tier editing | Inline two-row table in `ContractForm` |
| Manual trigger override | `TriggerOverride.tsx` → `overrideContractTrigger` action |
| Override audit log | `admin_audit_log` table, written on every override |
| Oracle monitor master/detail | `OracleMonitor.tsx` — left panel + right panel |
| Oracle bar chart + reading log | Right panel in `OracleMonitor.tsx` |
| Stale feed detection | Readings > 10 min old highlighted amber |
| Payout queue with stats | `PayoutQueue.tsx` — stats strip + filter tabs |
| Retry stuck payouts | Retry button → `retryPayout` action → existing `payoutPosition` |
