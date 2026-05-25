# Insu Threat Model — STRIDE Analysis

**Date:** 2026-05-24  
**Scope:** Payment flow, oracle trigger, payout settlement, admin overrides  
**Methodology:** STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)

---

## System Overview

Insu is a parametric insurance marketplace. Users (hedgers) pay premiums for coverage contracts; providers deposit capital. When an oracle reading meets a trigger condition, the system automatically pays out to eligible hedgers.

**Trust boundaries:**
1. Public internet → Next.js app (Vercel edge)
2. Next.js server → Supabase (service role vs. anon key)
3. Next.js server → Stripe API
4. Stripe → Next.js webhook endpoint
5. Oracle sources (OpenWeatherMap, Tomorrow.io, Waze) → oracle poll

---

## Flow 1: Hedger Purchase Flow

```
Browser → createHedgerPaymentIntent → Stripe PI created → Stripe.js collects card
→ payment_intent.succeeded webhook → position activated → capacity incremented
```

| STRIDE | Threat | Mitigation | Status |
|--------|--------|------------|--------|
| **S** Spoofing | Attacker forges webhook to activate positions | `stripe.webhooks.constructEvent()` signature verification | ✅ Fixed |
| **S** Spoofing | Attacker supplies another user's `position_id` in PI metadata | Webhook now requires `.eq('payment_intent_id', pi.id)` | ✅ Fixed |
| **T** Tampering | Client modifies `premium_usd` before sending to server | Premium computed server-side from DB tier, not client input | ✅ |
| **T** Tampering | Race condition oversells capacity | Atomic SQL increment via `rpc('increment_tier_capacity')` | ✅ Fixed |
| **T** Tampering | `payout_amount_usd` inflated on position row before settlement | Processor now fetches authoritative amount from `coverage_tiers` | ✅ Fixed |
| **R** Repudiation | No audit trail of purchases | `payment_intent_id` stored on position; Stripe dashboard is audit log | ✅ |
| **I** Info Disclosure | Stripe errors logged with sensitive details | Errors logged server-side only, msg sanitised before user output | ✅ |
| **D** DoS | Capacity exhaustion by creating many `pending_payment` positions | **OPEN** — No rate limit or pending position count per user |
| **E** Privilege Escalation | Regular user activates a cancelled/expired position | Webhook activation blocked by `payment_intent_id` match | ✅ Fixed |

**Residual risk:** Pending position flood — a user can create unlimited `pending_payment` positions without completing payment, consuming DB rows. Recommend: add max 5 pending positions per user check in `createHedgerPaymentIntent`.

---

## Flow 2: Oracle Trigger & Payout Settlement

```
Cron → processPayouts → oracle_readings with trigger_met=true
→ settleContract → payoutPosition → Stripe balance transaction
```

| STRIDE | Threat | Mitigation | Status |
|--------|--------|------------|--------|
| **S** Spoofing | Attacker injects fake oracle reading to trigger payout | `injectReading` now requires admin role | ✅ Fixed |
| **S** Spoofing | Attacker spoofs oracle API responses | External APIs called server-side; no client-supplied URL | ✅ |
| **T** Tampering | Oracle readings mutated after insert | No UPDATE policy on `oracle_readings` for users | ✅ |
| **T** Tampering | `settled_outcome` set to true without admin override | `overrideContractTrigger` gated by `assertAdmin()` | ✅ |
| **R** Repudiation | Admin override leaves no trace | Admin audit log written to `admin_audit_log` table | ✅ |
| **I** Info Disclosure | Oracle API keys exposed in client bundle | Keys accessed only via `process.env` in server context | ✅ |
| **D** DoS | Cron endpoint called without CRON_SECRET | `/api/oracle-poll` checks `Authorization: Bearer` header | ✅ |
| **D** DoS | Settlement loop hangs on Stripe timeout | `try/catch` around each Stripe call; partial settlements continue | ✅ |
| **E** Privilege Escalation | Cron secret leaked allows forced settlement | `CRON_SECRET` is env var, not in code; rotate if compromised | ✅ |

---

## Flow 3: Admin Override Flow

```
Admin UI → overrideContractTrigger → settleContract → payouts → retryPayout
```

| STRIDE | Threat | Mitigation | Status |
|--------|--------|------------|--------|
| **S** Spoofing | Non-admin calls admin server actions | `assertAdmin()` checks profile role via service client | ✅ |
| **T** Tampering | Admin double-settles a contract | `settled_outcome IS NOT NULL` checked before settlement | ✅ |
| **T** Tampering | Admin retries already-processed payout | `retryPayout` now checks `transfer_id` and `processing` status | ✅ Fixed |
| **R** Repudiation | Admin actions not logged | `admin_audit_log` insert on every `overrideContractTrigger` | ✅ |
| **I** Info Disclosure | Admin pages accessible to unauthenticated users | Middleware now redirects `/admin` to login if not authenticated | ✅ Fixed |
| **E** Privilege Escalation | Hedger escalates to admin by modifying profile.role | `profiles.role` UPDATE policy only allows own row; role change requires service role | ⚠️ |

**Residual risk (⚠️):** The `profiles` UPDATE RLS policy allows users to update their own profile row. A user could potentially set their own `role` to `admin` unless the UPDATE policy enforces allowed role values. Recommend: add `WITH CHECK (role = OLD.role OR auth.role() = 'service_role')` constraint, or handle role changes exclusively via service role.

---

## Flow 4: Provider Deposit Flow

```
Browser → createProviderPaymentIntent → Stripe PI → webhook activates provider position
```

| STRIDE | Threat | Mitigation | Status |
|--------|--------|------------|--------|
| **S** Spoofing | Webhook activates wrong provider position | Webhook now requires `.eq('payment_intent_id', pi.id)` | ✅ Fixed |
| **T** Tampering | Provider withdraws capital before settlement | No withdrawal endpoint; capital locked until `settled_at` | ✅ |
| **D** DoS | Provider floods tiers with tiny deposits | Minimum $10 enforced in `createProviderPaymentIntent` | ✅ |

---

## Open Risks Summary

| # | Risk | Severity | Recommendation |
|---|------|----------|----------------|
| 1 | Pending position flood (no rate limit) | Medium | Max 5 pending positions per user in `createHedgerPaymentIntent` |
| 2 | User can self-elevate `profile.role` | High | Add `WITH CHECK` constraint on profiles UPDATE policy |
| 3 | Next.js CVEs (requires v16 upgrade) | High | Upgrade `next` to 16.x in a dedicated branch with smoke testing |
| 4 | `admin_audit_log` table not in migrations | Low | Add migration to create and RLS-protect the table |
| 5 | No rate limiting on API routes | Medium | Add Vercel rate limiting or `next-rate-limit` middleware |
