# Incident Response Plan

**Effective:** 2026-05-24  
**Owner:** Engineering lead  
**Review cadence:** Quarterly, or after any incident

---

## Severity Classification

| Level | Definition | Response SLA |
|-------|-----------|-------------|
| P0 — Critical | Payment data compromised, active breach, service down | 15 min |
| P1 — High | Auth bypass, admin access by unauthorised user, data leak | 1 hour |
| P2 — Medium | Elevated error rate, non-critical service degraded | 4 hours |
| P3 — Low | Security misconfiguration with no active exploitation | 24 hours |

---

## Contacts

| Role | Contact | Escalation |
|------|---------|-----------|
| On-call engineer | Sentry alerts → PagerDuty | Engineering lead |
| Engineering lead | [add contact] | CTO |
| Stripe support | support.stripe.com | dashboard.stripe.com |
| Supabase support | support.supabase.com | status.supabase.com |

---

## Runbook: Payment Data Compromise (P0)

1. **Contain (< 15 min)**
   - Rotate `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Vercel env → redeploy
   - Rotate `SUPABASE_SERVICE_ROLE_KEY` in Vercel env → redeploy
   - Enable Vercel maintenance mode to block new purchases
2. **Assess**
   - Query `admin_audit_log` for unusual actions in the past 48 hours
   - Query Stripe dashboard for unexpected charges or payouts
   - Check Supabase auth logs for unusual login patterns
3. **Notify (< 72 hours if personal data affected — GDPR Art. 33)**
   - Notify affected users by email
   - File breach report with relevant data protection authority
   - If card data potentially exposed: notify Stripe (they notify card brands)
4. **Remediate**
   - Apply the specific fix to the compromised code path
   - Re-audit RLS policies and server actions
   - Deploy fix, lift maintenance mode
5. **Post-incident (within 5 business days)**
   - Write post-mortem: timeline, root cause, impact, remediation, prevention
   - Update threat model and this document

---

## Runbook: Credential Rotation

Rotate all secrets if any credential is suspected compromised:

```bash
# 1. Generate new secrets
openssl rand -base64 32  # for CRON_SECRET

# 2. Update in Vercel dashboard
# Settings → Environment Variables → update each value → Save
# (Stripe and Supabase have their own key rotation flows)

# 3. Trigger redeploy
vercel --prod

# 4. Verify service health
curl -s https://your-domain.com/api/health
```

---

## Runbook: Unauthorised Admin Access (P1)

1. Disable the compromised admin account in Supabase Auth → Users
2. Check `admin_audit_log` for actions taken by that account
3. Reverse any fraudulent contract settlements via `retryPayout` or direct DB correction
4. Audit all positions activated in the past 24 hours
5. Re-enable account only after MFA re-enrollment is confirmed

---

## Credential Inventory

| Secret | Location | Rotation Period | Owner |
|--------|---------|----------------|-------|
| STRIPE_SECRET_KEY | Vercel env | On compromise or 90 days | Stripe dashboard |
| STRIPE_WEBHOOK_SECRET | Vercel env | On compromise | Stripe dashboard |
| SUPABASE_SERVICE_ROLE_KEY | Vercel env | On compromise | Supabase dashboard |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Vercel env | On compromise | Supabase dashboard |
| CRON_SECRET | Vercel env | 90 days | `openssl rand -base64 32` |
| SENTRY_AUTH_TOKEN | Vercel env + CI | On compromise | sentry.io |
