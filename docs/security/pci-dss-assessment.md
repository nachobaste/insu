# PCI-DSS Compliance Assessment

**Date:** 2026-05-24  
**Standard:** PCI-DSS v4.0  
**SAQ Type:** SAQ A (card processing fully outsourced to Stripe)  
**Scope:** Insu web application handling Stripe payment intents

---

## SAQ A Applicability

Insu qualifies for **SAQ A** because:
- Cardholder data entry is handled entirely by Stripe.js (hosted fields / Payment Element)
- No cardholder data is stored, processed, or transmitted through Insu servers
- Stripe is a PCI-DSS Level 1 certified service provider

---

## Requirements Assessment

### Req 1 — Install and Maintain Network Security Controls
| Check | Status | Notes |
|-------|--------|-------|
| HTTPS enforced | ✅ | Vercel enforces TLS; HSTS header added |
| No direct DB exposure | ✅ | Supabase connection via SDK only |
| Admin interfaces restricted | ⚠️ | `/admin` routes are auth-gated but no IP allowlist |

**Gap:** Admin routes have no IP restriction. Recommend Vercel password protection or IP allowlist for `/admin` in production.

### Req 2 — Apply Secure Configurations
| Check | Status | Notes |
|-------|--------|-------|
| No default credentials | ✅ | Supabase/Stripe use API keys, not default passwords |
| Unnecessary services disabled | ✅ | No unused API routes |
| Security headers set | ✅ | X-Frame-Options, CSP, HSTS, X-Content-Type-Options added |

### Req 3 — Protect Stored Account Data
| Check | Status | Notes |
|-------|--------|-------|
| No PAN stored | ✅ | Stripe stores card data; we store only `stripe_customer_id` |
| No CVV stored | ✅ | Never received by server |
| Sensitive auth data not retained | ✅ | No auth data in DB |

### Req 4 — Protect Cardholder Data in Transit
| Check | Status | Notes |
|-------|--------|-------|
| TLS 1.2+ enforced | ✅ | Vercel and Supabase enforce TLS 1.2+ |
| Stripe.js loaded from Stripe CDN | ✅ | `https://js.stripe.com` in CSP |
| Webhook signature verified | ✅ | `stripe.webhooks.constructEvent()` implemented |

### Req 5 — Protect Systems Against Malicious Software
| Check | Status | Notes |
|-------|--------|-------|
| Dependency scanning | ⚠️ | `npm audit` added to CI; 4 high CVEs in Next.js pending upgrade |
| SAST in pipeline | ✅ | Semgrep added to CI workflow |
| No malicious npm packages detected | ✅ | No known compromised packages in dependency tree |

**Gap:** Next.js 14.2.35 has 4 high CVEs (cache poisoning, DoS, request smuggling). Upgrade to Next.js 16.x required.

### Req 6 — Develop and Maintain Secure Systems
| Check | Status | Notes |
|-------|--------|-------|
| Security patches applied | ⚠️ | Next.js upgrade pending |
| Secure development practices | ✅ | RLS, auth checks, input validation in place |
| Code review process | ✅ | Security audit completed; REVIEW.md in repo |
| OWASP Top 10 addressed | ✅ | Injection, broken auth, access control all reviewed |

### Req 7 — Restrict Access by Business Need
| Check | Status | Notes |
|-------|--------|-------|
| Principle of least privilege | ✅ | RLS policies; service role only where necessary |
| Admin role enforcement | ✅ | `assertAdmin()` on all admin server actions |
| Users see only their own data | ✅ | RLS `auth.uid() = user_id` on positions/payouts |

### Req 8 — Identify Users and Authenticate Access
| Check | Status | Notes |
|-------|--------|-------|
| Unique user IDs | ✅ | Supabase Auth UUIDs |
| Password security | ✅ | Handled by Supabase Auth (bcrypt) |
| MFA available | ⚠️ | Supabase supports TOTP MFA but not enforced for admins |
| Session management | ✅ | Supabase JWT with refresh token rotation |

**Gap:** Admin users should be required to use MFA. Enable MFA enforcement in Supabase Auth settings for admin accounts.

### Req 9 — Restrict Physical Access
| N/A | Covered by Vercel/Supabase infrastructure |

### Req 10 — Log and Monitor All Access
| Check | Status | Notes |
|-------|--------|-------|
| Admin actions logged | ✅ | `admin_audit_log` table records all overrides |
| Auth events logged | ✅ | Supabase Auth logs all sign-in/sign-out events |
| Payment events logged | ✅ | Stripe dashboard + `payouts` table |
| Log retention | ⚠️ | No explicit log retention policy; Supabase default is 30 days |

**Gap:** Define a log retention policy. Supabase logs expire after 30 days on free tier. Consider exporting to persistent storage.

### Req 11 — Test Security of Systems Regularly
| Check | Status | Notes |
|-------|--------|-------|
| Vulnerability scanning | ✅ | `npm audit --audit-level=high` in CI |
| SAST | ✅ | Semgrep with OWASP Top 10 ruleset in CI |
| Penetration test | ⚠️ | Manual security audit performed; no formal pentest |
| Security monitoring | ⚠️ | No runtime alerting (no Sentry, Datadog, etc.) |

**Gap:** Perform a formal penetration test before processing real payments. Set up runtime error monitoring (Sentry recommended for Next.js).

### Req 12 — Support Information Security with Policies
| Check | Status | Notes |
|-------|--------|-------|
| Security policy exists | ⚠️ | This document and threat model are a start; formal policy needed |
| Incident response plan | ⚠️ | Not documented |
| Vendor management | ✅ | Stripe PCI Level 1, Supabase SOC 2 |

---

## Gaps Prioritized

| Priority | Requirement | Gap | Action |
|----------|-------------|-----|--------|
| 🔴 High | Req 5/6 | Next.js 14 CVEs (cache poisoning, request smuggling) | Upgrade to Next.js 16.x |
| 🔴 High | Req 8 | MFA not enforced for admin accounts | Enable MFA in Supabase Auth for admin role |
| 🟡 Medium | Req 7 | User can self-modify `profile.role` | Add `WITH CHECK` to profiles UPDATE RLS policy |
| 🟡 Medium | Req 1 | No IP restriction on `/admin` | Add Vercel password protection or IP allowlist |
| 🟡 Medium | Req 11 | No runtime monitoring | Add Sentry for error tracking |
| 🟢 Low | Req 10 | Log retention undefined | Set up log export to persistent storage |
| 🟢 Low | Req 12 | No formal incident response plan | Document breach notification procedure |

---

## Next Steps to Reach SAQ A Compliance

1. **Upgrade Next.js** to 16.x — resolves all high CVEs
2. **Enforce MFA** for admin accounts in Supabase Auth dashboard
3. **Fix profiles UPDATE RLS** — add `WITH CHECK` to prevent self-elevation
4. **Add Sentry** for runtime monitoring
5. **Document incident response** — minimum: who to notify, how to rotate credentials, breach notification timeline
