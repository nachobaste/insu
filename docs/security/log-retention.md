# Log Retention Policy

**Effective:** 2026-05-24  
**Requirement:** PCI-DSS v4.0 Requirement 10.7 — retain audit logs for at least 12 months, with 3 months immediately available.

## Log Sources

| Source | Default Retention | Target Retention | Method |
|--------|------------------|-----------------|--------|
| Supabase Auth logs | 30 days (free tier) | 12 months | Logflare drain |
| Supabase DB logs | 30 days | 12 months | Logflare drain |
| Vercel access logs | 30 days | 12 months | Vercel Log Drains → S3 |
| Stripe events | 30 days (dashboard) | Indefinite | Stripe webhooks → `payouts` table |
| Admin audit log | Indefinite (in DB) | Indefinite | `admin_audit_log` table |

## Setup Instructions

### Supabase → Logflare
1. In Supabase dashboard: **Settings → Log Drains → Add Drain**
2. Select Logflare as destination
3. Copy the Logflare source token to `LOGFLARE_SOURCE_TOKEN` env var
4. Verify logs appear at logflare.app

### Vercel → S3 (production)
1. In Vercel dashboard: **Settings → Log Drains → Add Drain**
2. Select S3 as destination, configure bucket name and IAM credentials
3. Enable log drain for: Function Logs, Edge Logs, Build Logs

## Access & Audit

- Only admin accounts may access Logflare and Vercel log dashboards
- Logs must not be modified or deleted
- Quarterly review: verify logs are present and searchable for the prior 3 months
