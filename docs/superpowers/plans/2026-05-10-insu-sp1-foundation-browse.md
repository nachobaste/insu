# Insu Sub-Project 1: Foundation + Marketplace Browse

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Next.js project, apply the full Supabase schema, and build the public browse marketplace page with all four category sections, live contract cards, and Supabase Realtime price/volume updates.

**Architecture:** Next.js 14 App Router (server components fetch data; thin client components handle interactivity). Supabase handles auth, DB, and Realtime. All 9 tables are created now so later sub-projects require no schema migrations.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, @supabase/ssr, Vitest + Testing Library, Playwright (e2e smoke test)

**Spec:** `docs/superpowers/specs/2026-05-10-insu-design.md`

---

## File Map

```
/
├── app/
│   ├── layout.tsx                      Root layout — fonts, providers, metadata
│   ├── page.tsx                        Browse page (/) — server component
│   ├── globals.css                     Global styles + Tailwind base
│   ├── auth/
│   │   ├── login/page.tsx              Login page
│   │   └── signup/page.tsx            Signup page
│   └── auth/callback/route.ts          Supabase OAuth callback handler
├── components/
│   ├── layout/
│   │   ├── Header.tsx                  Top nav: logo, search, auth buttons
│   │   └── CategoryTabs.tsx            Horizontal category filter tabs
│   ├── contracts/
│   │   ├── ContractCard.tsx            Single contract card (client component)
│   │   ├── AddContractCard.tsx         "Submit your own program" card
│   │   ├── StatsBar.tsx                Platform stats ticker
│   │   └── ContractSection.tsx         Category section: header + grid of cards
│   └── auth/
│       ├── LoginForm.tsx               Email/password login form
│       └── SignupForm.tsx              Signup form
├── lib/
│   ├── supabase/
│   │   ├── client.ts                   Browser Supabase client
│   │   ├── server.ts                   Server Supabase client (cookies)
│   │   └── database.types.ts          Auto-generated DB types (supabase gen types)
│   ├── types.ts                        App-level TypeScript types
│   └── utils.ts                        formatCurrency, formatVolume helpers
├── hooks/
│   └── useRealtimeContracts.ts         Subscribe to live contract price/volume changes
├── supabase/
│   └── migrations/
│       ├── 20260510000001_schema.sql   Full DB schema + RLS + indexes + trigger
│       └── 20260510000002_seed.sql     Seed: categories + 8 sample contracts
├── tests/
│   ├── components/
│   │   ├── ContractCard.test.tsx
│   │   ├── CategoryTabs.test.tsx
│   │   ├── StatsBar.test.tsx
│   │   └── Header.test.tsx
│   ├── lib/
│   │   └── utils.test.ts
│   └── e2e/
│       └── browse.spec.ts              Playwright smoke test
├── middleware.ts                        Supabase session refresh middleware
├── vitest.config.ts                     Vitest + jsdom config
├── vitest.setup.ts                      Testing Library matchers setup
├── playwright.config.ts                 Playwright e2e config
├── tailwind.config.ts                   Theme tokens (colors, fonts)
└── .env.local.example                   Required env vars
```

---

## Task 1: Scaffold Next.js Project

**Files:**
- Create: root project directory as a Next.js 14 app

- [ ] **Step 1: Create the app**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu
npx create-next-app@14 . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir=no \
  --import-alias="@/*"
```

When prompted, accept all defaults. Answer "Yes" to App Router.

- [ ] **Step 2: Install core dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr \
  clsx tailwind-merge lucide-react \
  @tanstack/react-query
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install -D vitest @vitest/coverage-v8 \
  @testing-library/react @testing-library/user-event \
  @testing-library/jest-dom \
  @vitejs/plugin-react jsdom \
  playwright @playwright/test \
  ts-node dotenv @types/dotenv
```

- [ ] **Step 4: Install shadcn/ui**

```bash
npx shadcn@latest init
```

When prompted:
- Style: **Default**
- Base color: **Slate**
- CSS variables: **Yes**

Then install the components we need:

```bash
npx shadcn@latest add button input badge
```

- [ ] **Step 5: Verify the app runs**

```bash
npm run dev
```

Expected: server starts on `http://localhost:3000` with no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js 14 project with Supabase and shadcn/ui"
```

---

## Task 2: Configure Tailwind Theme Tokens

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `app/globals.css`

- [ ] **Step 1: Write tailwind config with Insu tokens**

Replace the contents of `tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#080c18',
          card: '#0e1420',
          'card-hover': '#121929',
        },
        border: {
          DEFAULT: 'rgba(255,255,255,0.07)',
          hover: 'rgba(255,255,255,0.15)',
        },
        insu: {
          text: '#e8edf5',
          muted: '#5a6580',
          dim: '#8491a8',
          accent: '#f5a623',
          green: '#22c55e',
        },
        category: {
          urban: '#94a3b8',
          nature: '#34d399',
          experiences: '#fb923c',
          events: '#a78bfa',
        },
      },
      fontFamily: {
        display: ['var(--font-bebas)', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'monospace'],
        body: ['var(--font-outfit)', 'sans-serif'],
        sans: ['var(--font-outfit)', 'sans-serif'],
      },
      borderRadius: {
        card: '14px',
      },
    },
  },
  plugins: [],
}

export default config
```

- [ ] **Step 2: Update globals.css with font imports and CSS variables**

Replace `app/globals.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;600;700&family=Outfit:wght@300;400;500;600;700&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --font-bebas: 'Bebas Neue';
  --font-jetbrains: 'JetBrains Mono';
  --font-outfit: 'Outfit';
}

@layer base {
  body {
    @apply bg-bg text-insu-text font-body;
  }

  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
}

@layer utilities {
  .vol-dot-pulse {
    animation: vol-pulse 2s ease-in-out infinite;
  }

  .card-fadein {
    animation: fadeUp 0.4s both;
  }
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes vol-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(0.7); }
}
```

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.ts app/globals.css
git commit -m "feat: configure Insu theme tokens and fonts"
```

---

## Task 3: Configure Test Environment

**Files:**
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Modify: `package.json` (add test script)

- [ ] **Step 1: Create vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
})
```

- [ ] **Step 2: Create vitest setup file**

```typescript
// vitest.setup.ts
import '@testing-library/jest-dom'
```

- [ ] **Step 3: Add test script to package.json**

In `package.json`, add to the `"scripts"` section:

```json
"test": "vitest",
"test:run": "vitest run",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 4: Run tests to verify setup works**

```bash
npm run test:run
```

Expected: `No test files found, exiting with code 0`

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts vitest.setup.ts package.json
git commit -m "chore: configure Vitest + Testing Library test environment"
```

---

## Task 4: Environment Variables

**Files:**
- Create: `.env.local.example`
- Create: `.env.local` (not committed)

- [ ] **Step 1: Create the example env file**

```bash
# .env.local.example
NEXT_PUBLIC_SUPABASE_URL=https://eagmczieznsogsxldedk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

- [ ] **Step 2: Create your actual .env.local**

Get keys from: Supabase dashboard → Project Settings → API

```bash
cp .env.local.example .env.local
# then fill in the real values
```

- [ ] **Step 3: Ensure .env.local and .superpowers are gitignored**

Check `.gitignore` already contains `.env.local` (create-next-app adds this). Add `.superpowers/` for the brainstorm visual companion files:

```bash
echo ".env.local" >> .gitignore       # if not already present
echo ".superpowers/" >> .gitignore
```

- [ ] **Step 4: Commit example file**

```bash
git add .env.local.example .gitignore
git commit -m "chore: add env var template"
```

---

## Task 5: Supabase Schema Migration

**Files:**
- Create: `supabase/migrations/20260510000001_schema.sql`

- [ ] **Step 1: Install Supabase CLI**

```bash
brew install supabase/tap/supabase
```

- [ ] **Step 2: Link to your Supabase project**

```bash
supabase login
supabase link --project-ref eagmczieznsogsxldedk
```

- [ ] **Step 3: Write the full schema migration**

Create `supabase/migrations/20260510000001_schema.sql`:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── PROFILES ───────────────────────────────────────────────────────────────
CREATE TABLE profiles (
  id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name           text,
  role                text NOT NULL DEFAULT 'hedger'
                        CHECK (role IN ('hedger','provider','admin','both')),
  preferred_currency  text NOT NULL DEFAULT 'USD'
                        CHECK (preferred_currency IN ('USD','MXN')),
  stripe_customer_id  text,
  conekta_customer_id text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── CATEGORIES ─────────────────────────────────────────────────────────────
CREATE TABLE categories (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          text NOT NULL CHECK (name IN ('Urban','Nature','Experiences','Events')),
  slug          text NOT NULL UNIQUE,
  color         text NOT NULL,
  icon_url      text,
  display_order int  NOT NULL DEFAULT 0
);

-- ─── CONTRACTS ──────────────────────────────────────────────────────────────
CREATE TABLE contracts (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug             text NOT NULL UNIQUE,
  title            text NOT NULL,
  description      text,
  category_id      uuid NOT NULL REFERENCES categories(id),
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','settled','cancelled','pending')),
  trigger_type     text NOT NULL
                     CHECK (trigger_type IN ('weather','urban','event','manual')),
  trigger_condition jsonb NOT NULL DEFAULT '{}',
  trigger_deadline  timestamptz NOT NULL,
  location          jsonb NOT NULL DEFAULT '{}',
  icon_url          text,
  total_volume_usd  numeric NOT NULL DEFAULT 0,
  total_volume_mxn  numeric NOT NULL DEFAULT 0,
  is_featured       boolean NOT NULL DEFAULT false,
  settled_outcome   boolean,
  created_by        uuid NOT NULL REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  settled_at        timestamptz
);

-- ─── COVERAGE TIERS ─────────────────────────────────────────────────────────
CREATE TABLE coverage_tiers (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id          uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  name                 text NOT NULL CHECK (name IN ('basic','premium')),
  premium_usd          numeric NOT NULL DEFAULT 0,
  payout_usd           numeric NOT NULL DEFAULT 0,
  premium_mxn          numeric NOT NULL DEFAULT 0,
  payout_mxn           numeric NOT NULL DEFAULT 0,
  max_capacity_usd     numeric NOT NULL DEFAULT 100000,
  current_capacity_usd numeric NOT NULL DEFAULT 0,
  base_probability     numeric NOT NULL DEFAULT 0.5
                         CHECK (base_probability >= 0 AND base_probability <= 1),
  last_priced_at       timestamptz,
  pricing_inputs       jsonb
);

-- ─── HEDGER POSITIONS ───────────────────────────────────────────────────────
CREATE TABLE hedger_positions (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            uuid NOT NULL REFERENCES profiles(id),
  contract_id        uuid NOT NULL REFERENCES contracts(id),
  tier_id            uuid NOT NULL REFERENCES coverage_tiers(id),
  premium_paid_usd   numeric NOT NULL DEFAULT 0,
  payout_amount_usd  numeric NOT NULL DEFAULT 0,
  premium_paid_mxn   numeric NOT NULL DEFAULT 0,
  payout_amount_mxn  numeric NOT NULL DEFAULT 0,
  currency           text NOT NULL CHECK (currency IN ('USD','MXN')),
  payment_provider   text NOT NULL CHECK (payment_provider IN ('stripe','conekta')),
  payment_intent_id  text,
  status             text NOT NULL DEFAULT 'pending_payment'
                       CHECK (status IN ('pending_payment','active','paid_out','expired','cancelled')),
  purchased_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL
);

-- ─── PROVIDER POSITIONS ─────────────────────────────────────────────────────
CREATE TABLE provider_positions (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               uuid NOT NULL REFERENCES profiles(id),
  contract_id           uuid NOT NULL REFERENCES contracts(id),
  tier_id               uuid NOT NULL REFERENCES coverage_tiers(id),
  capital_deposited_usd numeric NOT NULL DEFAULT 0,
  capital_deposited_mxn numeric NOT NULL DEFAULT 0,
  currency              text NOT NULL CHECK (currency IN ('USD','MXN')),
  payment_provider      text NOT NULL CHECK (payment_provider IN ('stripe','conekta')),
  payment_intent_id     text,
  expected_return_usd   numeric NOT NULL DEFAULT 0,
  actual_return_usd     numeric,
  expected_return_mxn   numeric NOT NULL DEFAULT 0,
  actual_return_mxn     numeric,
  status                text NOT NULL DEFAULT 'pending_payment'
                           CHECK (status IN ('pending_payment','active','settled','cancelled')),
  deposited_at          timestamptz NOT NULL DEFAULT now(),
  settled_at            timestamptz
);

-- ─── ORACLE READINGS ────────────────────────────────────────────────────────
CREATE TABLE oracle_readings (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id  uuid NOT NULL REFERENCES contracts(id),
  source       text NOT NULL CHECK (source IN ('openweathermap','tomorrow_io','waze','manual')),
  reading_type text NOT NULL,
  value        jsonb NOT NULL DEFAULT '{}',
  trigger_met  boolean NOT NULL DEFAULT false,
  read_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── PAYOUTS ────────────────────────────────────────────────────────────────
CREATE TABLE payouts (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id         uuid NOT NULL REFERENCES contracts(id),
  hedger_position_id  uuid NOT NULL REFERENCES hedger_positions(id),
  amount_usd          numeric NOT NULL DEFAULT 0,
  amount_mxn          numeric NOT NULL DEFAULT 0,
  currency            text NOT NULL CHECK (currency IN ('USD','MXN')),
  payment_provider    text NOT NULL CHECK (payment_provider IN ('stripe','conekta')),
  transfer_id         text,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','completed','failed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);

-- ─── PRICING HISTORY ────────────────────────────────────────────────────────
CREATE TABLE pricing_history (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id         uuid NOT NULL REFERENCES contracts(id),
  tier_id             uuid NOT NULL REFERENCES coverage_tiers(id),
  bs_inputs           jsonb NOT NULL DEFAULT '{}',
  bs_output           jsonb NOT NULL DEFAULT '{}',
  premium_usd_before  numeric NOT NULL DEFAULT 0,
  premium_usd_after   numeric NOT NULL DEFAULT 0,
  calculated_at       timestamptz NOT NULL DEFAULT now()
);

-- ─── INDEXES ────────────────────────────────────────────────────────────────
CREATE INDEX idx_contracts_category  ON contracts(category_id);
CREATE INDEX idx_contracts_status    ON contracts(status);
CREATE INDEX idx_contracts_slug      ON contracts(slug);
CREATE INDEX idx_tiers_contract      ON coverage_tiers(contract_id);
CREATE INDEX idx_hedger_user         ON hedger_positions(user_id);
CREATE INDEX idx_hedger_contract     ON hedger_positions(contract_id);
CREATE INDEX idx_provider_user       ON provider_positions(user_id);
CREATE INDEX idx_oracle_contract     ON oracle_readings(contract_id);
CREATE INDEX idx_payouts_position    ON payouts(hedger_position_id);

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────────────────────
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_tiers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hedger_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE oracle_readings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_history  ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "Own profile select" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Own profile update" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Own profile insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- categories — public read
CREATE POLICY "Categories public" ON categories FOR SELECT USING (true);

-- contracts — public read for active/settled
CREATE POLICY "Contracts public" ON contracts FOR SELECT
  USING (status IN ('active','settled'));

-- coverage_tiers — public read
CREATE POLICY "Tiers public" ON coverage_tiers FOR SELECT USING (true);

-- hedger_positions — own only
CREATE POLICY "Own hedger positions" ON hedger_positions FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Insert hedger position" ON hedger_positions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- provider_positions — own only
CREATE POLICY "Own provider positions" ON provider_positions FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Insert provider position" ON provider_positions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- payouts — own only (via hedger_position)
CREATE POLICY "Own payouts" ON payouts FOR SELECT USING (
  auth.uid() = (
    SELECT user_id FROM hedger_positions WHERE id = hedger_position_id
  )
);

-- oracle_readings and pricing_history — public read
CREATE POLICY "Oracle public"  ON oracle_readings  FOR SELECT USING (true);
CREATE POLICY "Pricing public" ON pricing_history  FOR SELECT USING (true);

-- ─── AUTO-CREATE PROFILE ON SIGNUP ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', '')
  );
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();
```

- [ ] **Step 4: Apply the migration**

```bash
supabase db push
```

Expected output: `Applying migration 20260510000001_schema.sql...` with no errors.

- [ ] **Step 5: Commit the migration file**

```bash
git add supabase/
git commit -m "feat: add full Supabase schema — all 9 tables, RLS, indexes, auth trigger"
```

---

## Task 6: Seed Data — Categories + Sample Contracts

**Files:**
- Create: `supabase/migrations/20260510000002_seed.sql`

- [ ] **Step 1: Write seed migration**

```sql
-- supabase/migrations/20260510000002_seed.sql

-- Categories
INSERT INTO categories (id, name, slug, color, display_order) VALUES
  ('11111111-0000-0000-0000-000000000001', 'Urban',       'urban',       '#94a3b8', 1),
  ('11111111-0000-0000-0000-000000000002', 'Nature',      'nature',      '#34d399', 2),
  ('11111111-0000-0000-0000-000000000003', 'Experiences', 'experiences', '#fb923c', 3),
  ('11111111-0000-0000-0000-000000000004', 'Events',      'events',      '#a78bfa', 4)
ON CONFLICT (id) DO NOTHING;

-- Sample contracts and tiers are inserted via the admin panel (sub-project 6).
-- This seed only establishes the category reference data required for all other data.
```

- [ ] **Step 2: Apply seed**

```bash
supabase db push
```

Expected: `Applying migration 20260510000002_seed.sql...` with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260510000002_seed.sql
git commit -m "feat: seed categories — Urban, Nature, Experiences, Events"
```

---

## Task 7: TypeScript Types

**Files:**
- Create: `lib/types.ts`
- Create: `lib/utils.ts`

- [ ] **Step 1: Generate Supabase database types**

```bash
supabase gen types typescript \
  --project-id eagmczieznsogsxldedk \
  > lib/supabase/database.types.ts
```

Expected: `lib/supabase/database.types.ts` created with auto-generated types for all 9 tables.

- [ ] **Step 2: Write app-level types**

```typescript
// lib/types.ts

export type CategoryName = 'Urban' | 'Nature' | 'Experiences' | 'Events'
export type ContractStatus = 'active' | 'settled' | 'cancelled' | 'pending'
export type TriggerType = 'weather' | 'urban' | 'event' | 'manual'
export type CoverageLevel = 'basic' | 'premium'
export type Currency = 'USD' | 'MXN'
export type UserRole = 'hedger' | 'provider' | 'admin' | 'both'

export interface Category {
  id: string
  name: CategoryName
  slug: string
  color: string
  icon_url: string | null
  display_order: number
}

export interface CoverageTier {
  id: string
  contract_id: string
  name: CoverageLevel
  premium_usd: number
  payout_usd: number
  premium_mxn: number
  payout_mxn: number
  max_capacity_usd: number
  current_capacity_usd: number
  base_probability: number
  last_priced_at: string | null
  pricing_inputs: Record<string, unknown> | null
}

export interface ContractLocation {
  lat: number
  lng: number
  city: string
  country: string
}

export interface Contract {
  id: string
  slug: string
  title: string
  description: string | null
  category_id: string
  category?: Category
  status: ContractStatus
  trigger_type: TriggerType
  trigger_condition: Record<string, unknown>
  trigger_deadline: string
  location: ContractLocation
  icon_url: string | null
  total_volume_usd: number
  total_volume_mxn: number
  is_featured: boolean
  settled_outcome: boolean | null
  created_by: string
  created_at: string
  settled_at: string | null
  coverage_tiers?: CoverageTier[]
}

export interface ContractWithTiers extends Contract {
  coverage_tiers: CoverageTier[]
  category: Category
}
```

- [ ] **Step 3: Write utility functions**

```typescript
// lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Currency } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency: Currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatVolume(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}m`
  if (usd >= 1_000)     return `$${(usd / 1_000).toFixed(0)}k`
  return `$${usd}`
}

export function categoryColorClass(slug: string): string {
  const map: Record<string, string> = {
    urban:       'text-category-urban border-category-urban',
    nature:      'text-category-nature border-category-nature',
    experiences: 'text-category-experiences border-category-experiences',
    events:      'text-category-events border-category-events',
  }
  return map[slug] ?? ''
}
```

- [ ] **Step 4: Write util tests**

```typescript
// tests/lib/utils.test.ts
import { describe, it, expect } from 'vitest'
import { formatCurrency, formatVolume, categoryColorClass } from '@/lib/utils'

describe('formatCurrency', () => {
  it('formats USD amounts', () => {
    expect(formatCurrency(500, 'USD')).toBe('$500')
    expect(formatCurrency(1700, 'USD')).toBe('$1,700')
  })

  it('formats MXN amounts', () => {
    expect(formatCurrency(9500, 'MXN')).toContain('9,500')
  })
})

describe('formatVolume', () => {
  it('formats millions', () => {
    expect(formatVolume(9_000_000)).toBe('$9m')
    expect(formatVolume(2_400_000)).toBe('$2.4m')
  })

  it('formats thousands', () => {
    expect(formatVolume(314_000)).toBe('$314k')
  })

  it('formats small amounts', () => {
    expect(formatVolume(500)).toBe('$500')
  })
})

describe('categoryColorClass', () => {
  it('returns correct class for each category', () => {
    expect(categoryColorClass('urban')).toContain('text-category-urban')
    expect(categoryColorClass('nature')).toContain('text-category-nature')
    expect(categoryColorClass('experiences')).toContain('text-category-experiences')
    expect(categoryColorClass('events')).toContain('text-category-events')
  })

  it('returns empty string for unknown category', () => {
    expect(categoryColorClass('unknown')).toBe('')
  })
})
```

- [ ] **Step 5: Run tests**

```bash
npm run test:run
```

Expected: `3 tests passed` (utils tests)

- [ ] **Step 6: Commit**

```bash
git add lib/ tests/lib/
git commit -m "feat: TypeScript types, Supabase DB types, and utility functions"
```

---

## Task 8: Supabase Client Setup

**Files:**
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `middleware.ts`

- [ ] **Step 1: Write browser client**

```typescript
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './database.types'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 2: Write server client**

```typescript
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from './database.types'

export function createClient() {
  const cookieStore = cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — cookies can't be set.
            // Middleware handles session refresh.
          }
        },
      },
    }
  )
}
```

- [ ] **Step 3: Write Next.js middleware for session refresh**

```typescript
// middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refreshes the session — do not remove.
  await supabase.auth.getUser()

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/client.ts lib/supabase/server.ts middleware.ts
git commit -m "feat: Supabase browser + server clients and session middleware"
```

---

## Task 9: Root Layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Write layout with font variables and metadata**

```tsx
// app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Insu — Everyday Risk, Instantly Covered',
  description:
    'Parametric event-protection marketplace. Buy protection against real-life disruptions. Automatic payouts when triggers occur.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: root layout with metadata"
```

---

## Task 10: Header Component

**Files:**
- Create: `components/layout/Header.tsx`
- Create: `tests/components/Header.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/Header.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Header from '@/components/layout/Header'

describe('Header', () => {
  it('renders the INSU wordmark', () => {
    render(<Header />)
    expect(screen.getByText('INSU')).toBeInTheDocument()
  })

  it('renders Log In and Sign Up buttons', () => {
    render(<Header />)
    expect(screen.getByRole('link', { name: /log in/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign up/i })).toBeInTheDocument()
  })

  it('renders the search input', () => {
    render(<Header />)
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('renders the How it works link', () => {
    render(<Header />)
    expect(screen.getByRole('link', { name: /how it works/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm run test:run tests/components/Header.test.tsx
```

Expected: `FAIL — Cannot find module '@/components/layout/Header'`

- [ ] **Step 3: Implement Header**

```tsx
// components/layout/Header.tsx
import Link from 'next/link'
import { Search } from 'lucide-react'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 flex h-[60px] items-center gap-5 border-b border-white/[0.07] bg-bg/85 px-8 backdrop-blur-xl">
      {/* Logo */}
      <Link href="/" className="flex flex-shrink-0 items-center gap-2.5">
        <svg width="28" height="22" viewBox="0 0 28 22" fill="none" aria-hidden>
          <polygon points="0,22 9,4 18,22" fill="#e8edf5" />
          <polygon points="10,22 19,4 28,22" fill="#f5a623" />
        </svg>
        <span className="font-display text-[26px] tracking-[4px] text-insu-text">
          INSU
        </span>
        <div className="mx-1 h-5 w-px bg-white/[0.07]" />
        <span className="text-[10px] font-medium uppercase leading-tight tracking-wide text-insu-muted">
          Everyday Risk,
          <br />
          Instantly Covered
        </span>
      </Link>

      {/* Search */}
      <div className="flex max-w-[440px] flex-1 items-center gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.04] px-3.5 py-2.5 transition-colors focus-within:border-insu-accent/30 focus-within:bg-insu-accent/[0.03]">
        <Search size={13} className="flex-shrink-0 text-insu-muted" />
        <input
          type="text"
          placeholder="Search contracts, events, locations…"
          className="flex-1 bg-transparent font-body text-[13.5px] text-insu-text outline-none placeholder:text-insu-muted"
        />
        <kbd className="rounded border border-white/[0.07] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-insu-muted">
          /
        </kbd>
      </div>

      <div className="flex-1" />

      {/* Nav links */}
      <Link
        href="/how-it-works"
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-insu-dim transition-colors hover:bg-white/[0.05] hover:text-insu-text"
      >
        How it works
      </Link>

      <Link
        href="/auth/login"
        className="rounded-lg border border-white/[0.07] px-4 py-1.5 text-[13px] font-semibold text-insu-dim transition-colors hover:border-white/15 hover:text-insu-text"
      >
        Log In
      </Link>

      <Link
        href="/auth/signup"
        className="rounded-lg bg-insu-accent px-4 py-1.5 text-[13px] font-bold text-bg transition-all hover:-translate-y-px hover:bg-[#f7b84a] hover:shadow-[0_4px_16px_rgba(245,166,35,0.3)]"
      >
        Sign Up
      </Link>
    </header>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm run test:run tests/components/Header.test.tsx
```

Expected: `4 tests passed`

- [ ] **Step 5: Commit**

```bash
git add components/layout/Header.tsx tests/components/Header.test.tsx
git commit -m "feat: Header component with logo, search, and auth links"
```

---

## Task 11: CategoryTabs Component

**Files:**
- Create: `components/layout/CategoryTabs.tsx`
- Create: `tests/components/CategoryTabs.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/CategoryTabs.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import CategoryTabs from '@/components/layout/CategoryTabs'
import type { Category } from '@/lib/types'

const mockCategories: Category[] = [
  { id: '1', name: 'Urban', slug: 'urban', color: '#94a3b8', icon_url: null, display_order: 1 },
  { id: '2', name: 'Nature', slug: 'nature', color: '#34d399', icon_url: null, display_order: 2 },
]

describe('CategoryTabs', () => {
  it('renders all category names', () => {
    render(<CategoryTabs categories={mockCategories} activeSlug="urban" onSelect={vi.fn()} />)
    expect(screen.getByText('Urban')).toBeInTheDocument()
    expect(screen.getByText('Nature')).toBeInTheDocument()
  })

  it('calls onSelect with slug when tab is clicked', async () => {
    const onSelect = vi.fn()
    render(<CategoryTabs categories={mockCategories} activeSlug="urban" onSelect={onSelect} />)
    await userEvent.click(screen.getByText('Nature'))
    expect(onSelect).toHaveBeenCalledWith('nature')
  })

  it('marks the active tab with aria-selected', () => {
    render(<CategoryTabs categories={mockCategories} activeSlug="nature" onSelect={vi.fn()} />)
    const tab = screen.getByRole('tab', { name: /nature/i })
    expect(tab).toHaveAttribute('aria-selected', 'true')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm run test:run tests/components/CategoryTabs.test.tsx
```

Expected: `FAIL — Cannot find module '@/components/layout/CategoryTabs'`

- [ ] **Step 3: Implement CategoryTabs**

```tsx
// components/layout/CategoryTabs.tsx
'use client'

import { cn } from '@/lib/utils'
import type { Category } from '@/lib/types'

const SLUG_STYLES: Record<string, string> = {
  urban:       'text-category-urban border-b-category-urban',
  nature:      'text-category-nature border-b-category-nature',
  experiences: 'text-category-experiences border-b-category-experiences',
  events:      'text-category-events border-b-category-events',
}

const DOT_STYLES: Record<string, string> = {
  urban:       'bg-category-urban',
  nature:      'bg-category-nature',
  experiences: 'bg-category-experiences',
  events:      'bg-category-events',
}

interface Props {
  categories: Category[]
  activeSlug: string
  onSelect: (slug: string) => void
}

export default function CategoryTabs({ categories, activeSlug, onSelect }: Props) {
  return (
    <nav
      role="tablist"
      className="flex overflow-x-auto border-b border-white/[0.07] bg-bg/70 px-8 scrollbar-none backdrop-blur-md"
    >
      {categories.map((cat) => {
        const isActive = cat.slug === activeSlug
        return (
          <button
            key={cat.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(cat.slug)}
            className={cn(
              'flex h-[46px] flex-shrink-0 items-center gap-2 border-b-2 px-5 text-xs font-bold uppercase tracking-[0.12em] transition-colors',
              isActive
                ? cn('border-b-2', SLUG_STYLES[cat.slug])
                : 'border-transparent text-insu-muted hover:text-insu-text'
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                isActive ? DOT_STYLES[cat.slug] : 'bg-insu-muted'
              )}
            />
            {cat.name}
          </button>
        )
      })}

      <div className="ml-auto flex">
        {['Trending', 'Ending Soon', 'New'].map((label) => (
          <button
            key={label}
            className="flex h-[46px] items-center px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-insu-muted transition-colors hover:text-insu-text"
          >
            {label}
          </button>
        ))}
      </div>
    </nav>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm run test:run tests/components/CategoryTabs.test.tsx
```

Expected: `3 tests passed`

- [ ] **Step 5: Commit**

```bash
git add components/layout/CategoryTabs.tsx tests/components/CategoryTabs.test.tsx
git commit -m "feat: CategoryTabs component with active state and category colors"
```

---

## Task 12: StatsBar Component

**Files:**
- Create: `components/contracts/StatsBar.tsx`
- Create: `tests/components/StatsBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/StatsBar.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import StatsBar from '@/components/contracts/StatsBar'

const mockStats = {
  totalVolumeUsd: 24_300_000,
  activeContracts: 142,
  protectionsSold: 8204,
  avgPayoutMinutes: 4.2,
}

describe('StatsBar', () => {
  it('renders volume formatted as millions', () => {
    render(<StatsBar stats={mockStats} />)
    expect(screen.getByText('$24.3m')).toBeInTheDocument()
  })

  it('renders active contracts count', () => {
    render(<StatsBar stats={mockStats} />)
    expect(screen.getByText('142')).toBeInTheDocument()
  })

  it('renders protections sold', () => {
    render(<StatsBar stats={mockStats} />)
    expect(screen.getByText('8,204')).toBeInTheDocument()
  })

  it('renders 100% auto-settled label', () => {
    render(<StatsBar stats={mockStats} />)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm run test:run tests/components/StatsBar.test.tsx
```

Expected: `FAIL — Cannot find module '@/components/contracts/StatsBar'`

- [ ] **Step 3: Implement StatsBar**

```tsx
// components/contracts/StatsBar.tsx
import { formatVolume } from '@/lib/utils'

interface Stats {
  totalVolumeUsd: number
  activeContracts: number
  protectionsSold: number
  avgPayoutMinutes: number
}

interface Props {
  stats: Stats
}

const items = [
  {
    key: 'totalVolumeUsd' as const,
    label: 'Total Volume',
    format: (v: number) => formatVolume(v),
    className: 'text-insu-accent',
  },
  {
    key: 'activeContracts' as const,
    label: 'Active Contracts',
    format: (v: number) => v.toLocaleString(),
    className: '',
  },
  {
    key: 'protectionsSold' as const,
    label: 'Protections Sold',
    format: (v: number) => v.toLocaleString(),
    className: '',
  },
  {
    key: 'avgPayoutMinutes' as const,
    label: 'Avg Payout Time',
    format: (v: number) => `${v} min`,
    className: '',
  },
]

export default function StatsBar({ stats }: Props) {
  return (
    <div className="relative mb-7 flex overflow-hidden rounded-card border border-white/[0.07] bg-bg-card">
      {/* Amber left accent */}
      <div className="absolute bottom-0 left-0 top-0 w-[3px] bg-insu-accent" />

      {items.map((item, i) => (
        <div
          key={item.key}
          className={`flex flex-1 flex-col items-center border-r border-white/[0.07] px-5 py-4 last:border-r-0`}
        >
          <span className={`font-mono text-[20px] font-bold tracking-tight ${item.className}`}>
            {item.format(stats[item.key])}
          </span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-insu-muted">
            {item.label}
          </span>
        </div>
      ))}

      {/* 100% auto-settled — always the last stat */}
      <div className="flex flex-1 flex-col items-center px-5 py-4">
        <span className="font-mono text-[20px] font-bold tracking-tight text-insu-green">
          100%
        </span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-insu-muted">
          Auto-Settled
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm run test:run tests/components/StatsBar.test.tsx
```

Expected: `4 tests passed`

- [ ] **Step 5: Commit**

```bash
git add components/contracts/StatsBar.tsx tests/components/StatsBar.test.tsx
git commit -m "feat: StatsBar component with platform metrics"
```

---

## Task 13: ContractCard Component

**Files:**
- Create: `components/contracts/ContractCard.tsx`
- Create: `components/contracts/AddContractCard.tsx`
- Create: `tests/components/ContractCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/ContractCard.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ContractCard from '@/components/contracts/ContractCard'
import type { ContractWithTiers } from '@/lib/types'

const mockContract: ContractWithTiers = {
  id: 'abc-123',
  slug: 'power-outage-cdmx',
  title: 'Power outage in CDMX of more than 2 hours?',
  description: null,
  category_id: '11111111-0000-0000-0000-000000000001',
  category: {
    id: '11111111-0000-0000-0000-000000000001',
    name: 'Urban',
    slug: 'urban',
    color: '#94a3b8',
    icon_url: null,
    display_order: 1,
  },
  status: 'active',
  trigger_type: 'manual',
  trigger_condition: {},
  trigger_deadline: '2026-01-31T23:59:59Z',
  location: { lat: 19.4, lng: -99.1, city: 'CDMX', country: 'MX' },
  icon_url: null,
  total_volume_usd: 9_000_000,
  total_volume_mxn: 0,
  is_featured: false,
  settled_outcome: null,
  created_by: 'admin',
  created_at: '2026-01-01T00:00:00Z',
  settled_at: null,
  coverage_tiers: [
    {
      id: 'tier-1',
      contract_id: 'abc-123',
      name: 'basic',
      premium_usd: 100,
      payout_usd: 500,
      premium_mxn: 1700,
      payout_mxn: 8500,
      max_capacity_usd: 100000,
      current_capacity_usd: 45000,
      base_probability: 0.18,
      last_priced_at: null,
      pricing_inputs: null,
    },
    {
      id: 'tier-2',
      contract_id: 'abc-123',
      name: 'premium',
      premium_usd: 600,
      payout_usd: 1700,
      premium_mxn: 10200,
      payout_mxn: 28900,
      max_capacity_usd: 100000,
      current_capacity_usd: 20000,
      base_probability: 0.18,
      last_priced_at: null,
      pricing_inputs: null,
    },
  ],
}

describe('ContractCard', () => {
  it('renders the contract title', () => {
    render(<ContractCard contract={mockContract} currency="USD" />)
    expect(
      screen.getByText('Power outage in CDMX of more than 2 hours?')
    ).toBeInTheDocument()
  })

  it('renders basic tier premium and payout', () => {
    render(<ContractCard contract={mockContract} currency="USD" />)
    expect(screen.getByText('$100')).toBeInTheDocument()
    expect(screen.getByText('$500')).toBeInTheDocument()
  })

  it('renders premium tier premium and payout', () => {
    render(<ContractCard contract={mockContract} currency="USD" />)
    expect(screen.getByText('$600')).toBeInTheDocument()
    expect(screen.getByText('$1,700')).toBeInTheDocument()
  })

  it('renders volume', () => {
    render(<ContractCard contract={mockContract} currency="USD" />)
    expect(screen.getByText('$9m Vol.')).toBeInTheDocument()
  })

  it('renders a Buy now button', () => {
    render(<ContractCard contract={mockContract} currency="USD" />)
    expect(screen.getByRole('button', { name: /buy now/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm run test:run tests/components/ContractCard.test.tsx
```

Expected: `FAIL — Cannot find module '@/components/contracts/ContractCard'`

- [ ] **Step 3: Implement ContractCard**

```tsx
// components/contracts/ContractCard.tsx
'use client'

import Link from 'next/link'
import { cn, formatCurrency, formatVolume } from '@/lib/utils'
import type { ContractWithTiers, Currency, CoverageLevel } from '@/lib/types'

const CARD_STYLES: Record<string, string> = {
  urban:       'before:bg-category-urban hover:shadow-[0_8px_32px_rgba(148,163,184,0.08),0_0_0_1px_rgba(148,163,184,0.15)]',
  nature:      'before:bg-category-nature hover:shadow-[0_8px_32px_rgba(52,211,153,0.08),0_0_0_1px_rgba(52,211,153,0.2)]',
  experiences: 'before:bg-category-experiences hover:shadow-[0_8px_32px_rgba(251,146,60,0.08),0_0_0_1px_rgba(251,146,60,0.2)]',
  events:      'before:bg-category-events hover:shadow-[0_8px_32px_rgba(167,139,250,0.08),0_0_0_1px_rgba(167,139,250,0.2)]',
}

const ICON_BG: Record<string, string> = {
  urban:       'bg-category-urban/10',
  nature:      'bg-category-nature/10',
  experiences: 'bg-category-experiences/10',
  events:      'bg-category-events/10',
}

const TIER_LABELS: Record<CoverageLevel, string> = {
  basic:   'Basic coverage',
  premium: 'Premium coverage',
}

interface Props {
  contract: ContractWithTiers
  currency: Currency
  badge?: 'trending' | 'new' | 'live'
}

const BADGE_STYLES = {
  trending: 'bg-insu-accent/15 text-insu-accent border border-insu-accent/25',
  new:      'bg-insu-green/10 text-insu-green border border-insu-green/25',
  live:     'bg-red-500/12 text-red-400 border border-red-500/25 animate-pulse',
}

export default function ContractCard({ contract, currency, badge }: Props) {
  const slug = contract.category.slug
  const tiers = contract.coverage_tiers.sort((a, b) =>
    a.name === 'basic' ? -1 : 1
  )

  return (
    <Link
      href={`/markets/${contract.slug}`}
      className={cn(
        'relative block cursor-pointer overflow-hidden rounded-card border border-white/[0.07] bg-bg-card p-[18px]',
        'transition-all duration-200 hover:-translate-y-0.5 hover:bg-bg-card-hover hover:border-white/15',
        'before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:rounded-t-card',
        'card-fadein',
        CARD_STYLES[slug] ?? ''
      )}
    >
      {badge && (
        <span
          className={cn(
            'absolute right-3.5 top-3.5 rounded px-[7px] py-[3px] text-[9px] font-bold uppercase tracking-[0.1em]',
            BADGE_STYLES[badge]
          )}
        >
          {badge}
        </span>
      )}

      {/* Icon */}
      <div
        className={cn(
          'mb-3 flex h-[38px] w-[38px] items-center justify-center rounded-[10px] text-lg',
          ICON_BG[slug] ?? 'bg-white/5'
        )}
      >
        {contract.icon_url ? (
          <img src={contract.icon_url} alt="" className="h-5 w-5" />
        ) : (
          <span>◆</span>
        )}
      </div>

      {/* Title */}
      <p className="mb-3.5 min-h-[40px] text-[13.5px] font-semibold leading-[1.45] text-insu-text">
        {contract.title}
      </p>

      {/* Price rows */}
      <div className="mb-3.5 space-y-0">
        {tiers.map((tier) => (
          <div
            key={tier.id}
            className="flex items-center justify-between border-b border-white/[0.04] py-1.5 last:border-none"
          >
            <span className="text-[11px] font-medium text-insu-muted">
              {TIER_LABELS[tier.name]}
            </span>
            <span className="font-mono text-[12px] font-bold text-insu-text">
              {formatCurrency(currency === 'USD' ? tier.premium_usd : tier.premium_mxn, currency)}
              <span className="mx-1 font-normal text-insu-muted">/</span>
              <span className="text-insu-green">
                {formatCurrency(currency === 'USD' ? tier.payout_usd : tier.payout_mxn, currency)}
              </span>
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-mono text-[10px] font-medium text-insu-muted">
          <span className="inline-block h-[5px] w-[5px] rounded-full bg-insu-green vol-dot-pulse" />
          {formatVolume(contract.total_volume_usd)} Vol.
        </span>
        <button
          onClick={(e) => {
            e.preventDefault()
            // Purchase flow handled in sub-project 2
          }}
          className="rounded-lg bg-insu-text px-3.5 py-1.5 text-[12px] font-bold text-bg transition-all hover:scale-105 hover:bg-insu-accent"
        >
          Buy now
        </button>
      </div>
    </Link>
  )
}
```

- [ ] **Step 4: Create AddContractCard**

```tsx
// components/contracts/AddContractCard.tsx
export default function AddContractCard() {
  return (
    <div className="flex min-h-[190px] cursor-pointer flex-col items-center justify-center gap-2.5 rounded-card border border-dashed border-white/10 bg-transparent transition-all hover:border-insu-accent/30 hover:bg-insu-accent/[0.03]">
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-white/15 text-lg text-insu-muted transition-all group-hover:border-insu-accent group-hover:text-insu-accent">
        +
      </div>
      <p className="text-center text-[12px] font-semibold tracking-wide text-insu-muted">
        Submit your
        <br />
        own program
      </p>
    </div>
  )
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npm run test:run tests/components/ContractCard.test.tsx
```

Expected: `5 tests passed`

- [ ] **Step 6: Commit**

```bash
git add components/contracts/ContractCard.tsx components/contracts/AddContractCard.tsx tests/components/ContractCard.test.tsx
git commit -m "feat: ContractCard and AddContractCard components"
```

---

## Task 14: ContractSection Component

**Files:**
- Create: `components/contracts/ContractSection.tsx`

- [ ] **Step 1: Implement ContractSection**

This is a pure layout component — no business logic, no test needed beyond visual verification.

```tsx
// components/contracts/ContractSection.tsx
import ContractCard from './ContractCard'
import AddContractCard from './AddContractCard'
import { cn } from '@/lib/utils'
import type { ContractWithTiers, Currency, CategoryName } from '@/lib/types'

const SECTION_STYLES: Record<string, string> = {
  urban:       'text-category-urban',
  nature:      'text-category-nature',
  experiences: 'text-category-experiences',
  events:      'text-category-events',
}

const SECTION_DESCRIPTIONS: Record<string, string> = {
  urban:       'City disruptions · Infrastructure · Mobility',
  nature:      'Weather · Earthquakes · Temperature extremes',
  experiences: 'Travel · Outdoor activities · Vacations',
  events:      'Concerts · Conferences · Public gatherings',
}

const SECTION_ICONS: Record<string, string> = {
  urban:       '🏙️',
  nature:      '🌿',
  experiences: '🎿',
  events:      '🎤',
}

interface Props {
  categoryName: CategoryName
  categorySlug: string
  contracts: ContractWithTiers[]
  currency: Currency
}

export default function ContractSection({
  categoryName,
  categorySlug,
  contracts,
  currency,
}: Props) {
  return (
    <section className="mt-9 first:mt-0">
      {/* Section header */}
      <div className="mb-4 flex items-baseline gap-3">
        <h2
          className={cn(
            'font-display text-[28px] tracking-[2px]',
            SECTION_STYLES[categorySlug] ?? ''
          )}
        >
          {SECTION_ICONS[categorySlug]} {categoryName}
        </h2>
        <p className="text-[12px] font-medium tracking-[0.05em] text-insu-muted">
          {SECTION_DESCRIPTIONS[categorySlug]}
        </p>
        <div className="h-px flex-1 bg-white/[0.07]" />
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-4 gap-3">
        {contracts.map((contract, i) => (
          <ContractCard
            key={contract.id}
            contract={contract}
            currency={currency}
            badge={
              contract.is_featured ? 'trending' : undefined
            }
          />
        ))}
        <AddContractCard />
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/contracts/ContractSection.tsx
git commit -m "feat: ContractSection layout component — category header + card grid"
```

---

## Task 15: Realtime Hook

**Files:**
- Create: `hooks/useRealtimeContracts.ts`

- [ ] **Step 1: Implement the Realtime subscription hook**

```typescript
// hooks/useRealtimeContracts.ts
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ContractWithTiers } from '@/lib/types'

export function useRealtimeContracts(initial: ContractWithTiers[]) {
  const [contracts, setContracts] = useState<ContractWithTiers[]>(initial)

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('contracts-realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'contracts',
        },
        (payload) => {
          setContracts((prev) =>
            prev.map((c) =>
              c.id === payload.new.id ? { ...c, ...(payload.new as Partial<ContractWithTiers>) } : c
            )
          )
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'coverage_tiers',
        },
        (payload) => {
          const updatedTier = payload.new as { id: string; contract_id: string }
          setContracts((prev) =>
            prev.map((c) =>
              c.id === updatedTier.contract_id
                ? {
                    ...c,
                    coverage_tiers: c.coverage_tiers.map((t) =>
                      t.id === updatedTier.id ? { ...t, ...payload.new } : t
                    ),
                  }
                : c
            )
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return contracts
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/useRealtimeContracts.ts
git commit -m "feat: useRealtimeContracts hook — live price and volume updates via Supabase Realtime"
```

---

## Task 16: Browse Page (Server Component)

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Write the browse page server component**

```tsx
// app/page.tsx
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import CategoryTabs from '@/components/layout/CategoryTabs'
import StatsBar from '@/components/contracts/StatsBar'
import ContractSection from '@/components/contracts/ContractSection'
import BrowseClient from './BrowseClient'
import type { ContractWithTiers, Category } from '@/lib/types'

async function getCategories(): Promise<Category[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('display_order')

  if (error) throw new Error(`Failed to load categories: ${error.message}`)
  return data ?? []
}

async function getContracts(): Promise<ContractWithTiers[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('contracts')
    .select(`
      *,
      category:categories(*),
      coverage_tiers(*)
    `)
    .eq('status', 'active')
    .order('is_featured', { ascending: false })
    .order('total_volume_usd', { ascending: false })

  if (error) throw new Error(`Failed to load contracts: ${error.message}`)
  return (data ?? []) as ContractWithTiers[]
}

async function getPlatformStats() {
  const supabase = createClient()
  const { data } = await supabase
    .from('contracts')
    .select('total_volume_usd')
    .eq('status', 'active')

  const totalVolumeUsd = (data ?? []).reduce((sum, c) => sum + (c.total_volume_usd ?? 0), 0)

  const { count: activeContracts } = await supabase
    .from('contracts')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')

  const { count: protectionsSold } = await supabase
    .from('hedger_positions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')

  return {
    totalVolumeUsd,
    activeContracts: activeContracts ?? 0,
    protectionsSold: protectionsSold ?? 0,
    avgPayoutMinutes: 4.2,
  }
}

export default async function BrowsePage() {
  const [categories, contracts, stats] = await Promise.all([
    getCategories(),
    getContracts(),
    getPlatformStats(),
  ])

  return (
    <>
      <Header />
      <BrowseClient
        categories={categories}
        initialContracts={contracts}
        stats={stats}
      />
    </>
  )
}
```

- [ ] **Step 2: Create BrowseClient — handles tab state and Realtime**

```tsx
// app/BrowseClient.tsx
'use client'

import { useState } from 'react'
import CategoryTabs from '@/components/layout/CategoryTabs'
import StatsBar from '@/components/contracts/StatsBar'
import ContractSection from '@/components/contracts/ContractSection'
import { useRealtimeContracts } from '@/hooks/useRealtimeContracts'
import type { Category, ContractWithTiers } from '@/lib/types'

interface Props {
  categories: Category[]
  initialContracts: ContractWithTiers[]
  stats: {
    totalVolumeUsd: number
    activeContracts: number
    protectionsSold: number
    avgPayoutMinutes: number
  }
}

export default function BrowseClient({ categories, initialContracts, stats }: Props) {
  const [activeSlug, setActiveSlug] = useState<string>('all')
  const contracts = useRealtimeContracts(initialContracts)

  const visibleCategories =
    activeSlug === 'all'
      ? categories
      : categories.filter((c) => c.slug === activeSlug)

  return (
    <>
      <CategoryTabs
        categories={categories}
        activeSlug={activeSlug}
        onSelect={(slug) => setActiveSlug(slug === activeSlug ? 'all' : slug)}
      />

      <main className="mx-auto max-w-[1320px] px-8 py-7">
        <StatsBar stats={stats} />

        {visibleCategories.map((cat) => {
          const catContracts = contracts.filter(
            (c) => c.category?.slug === cat.slug
          )
          if (catContracts.length === 0) return null
          return (
            <ContractSection
              key={cat.id}
              categoryName={cat.name}
              categorySlug={cat.slug}
              contracts={catContracts}
              currency="USD"
            />
          )
        })}
      </main>
    </>
  )
}
```

- [ ] **Step 3: Start the dev server and verify**

```bash
npm run dev
```

Open `http://localhost:3000`. Expected: browse page renders with header, category tabs, stats bar. (Cards will appear once contracts are seeded in Task 19.)

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/BrowseClient.tsx
git commit -m "feat: browse page — server component fetches contracts, BrowseClient handles Realtime + tab state"
```

---

## Task 17: Auth Pages

**Files:**
- Create: `components/auth/LoginForm.tsx`
- Create: `components/auth/SignupForm.tsx`
- Create: `app/auth/login/page.tsx`
- Create: `app/auth/signup/page.tsx`
- Create: `app/auth/callback/route.ts`

- [ ] **Step 1: Create LoginForm**

```tsx
// components/auth/LoginForm.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="mb-1 font-display text-[36px] tracking-[3px] text-insu-text">
        Welcome back
      </h1>
      <p className="mb-8 text-[13px] text-insu-muted">
        Don&apos;t have an account?{' '}
        <Link href="/auth/signup" className="text-insu-accent hover:underline">
          Sign up
        </Link>
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-insu-muted">
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-white/[0.07] bg-bg-card px-4 py-2.5 text-[14px] text-insu-text outline-none transition-colors focus:border-insu-accent/40 focus:bg-insu-accent/[0.02]"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-insu-muted">
            Password
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-white/[0.07] bg-bg-card px-4 py-2.5 text-[14px] text-insu-text outline-none transition-colors focus:border-insu-accent/40 focus:bg-insu-accent/[0.02]"
          />
        </div>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-4 py-2.5 text-[13px] text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-insu-accent py-2.5 text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a] disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Log In'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Create SignupForm**

```tsx
// components/auth/SignupForm.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function SignupForm() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <div className="mx-auto w-full max-w-sm text-center">
        <div className="mb-4 text-4xl">✉️</div>
        <h2 className="mb-2 font-display text-[28px] tracking-[2px] text-insu-text">
          Check your email
        </h2>
        <p className="text-[13px] text-insu-muted">
          We sent a confirmation link to{' '}
          <span className="text-insu-text">{email}</span>
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="mb-1 font-display text-[36px] tracking-[3px] text-insu-text">
        Get protected
      </h1>
      <p className="mb-8 text-[13px] text-insu-muted">
        Already have an account?{' '}
        <Link href="/auth/login" className="text-insu-accent hover:underline">
          Log in
        </Link>
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-insu-muted">
            Full Name
          </label>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-lg border border-white/[0.07] bg-bg-card px-4 py-2.5 text-[14px] text-insu-text outline-none transition-colors focus:border-insu-accent/40 focus:bg-insu-accent/[0.02]"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-insu-muted">
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-white/[0.07] bg-bg-card px-4 py-2.5 text-[14px] text-insu-text outline-none transition-colors focus:border-insu-accent/40 focus:bg-insu-accent/[0.02]"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-insu-muted">
            Password
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-white/[0.07] bg-bg-card px-4 py-2.5 text-[14px] text-insu-text outline-none transition-colors focus:border-insu-accent/40 focus:bg-insu-accent/[0.02]"
          />
        </div>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-4 py-2.5 text-[13px] text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-insu-accent py-2.5 text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a] disabled:opacity-50"
        >
          {loading ? 'Creating account…' : 'Sign Up'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Create auth page routes**

```tsx
// app/auth/login/page.tsx
import LoginForm from '@/components/auth/LoginForm'

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <LoginForm />
    </main>
  )
}
```

```tsx
// app/auth/signup/page.tsx
import SignupForm from '@/components/auth/SignupForm'

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <SignupForm />
    </main>
  )
}
```

- [ ] **Step 4: Create OAuth callback route**

```typescript
// app/auth/callback/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = createClient()
    await supabase.auth.exchangeCodeForSession(code)
  }

  return NextResponse.redirect(`${origin}/`)
}
```

- [ ] **Step 5: Verify auth pages render**

```bash
npm run dev
```

Open `http://localhost:3000/auth/login` and `http://localhost:3000/auth/signup`. Expected: both pages render with Insu styling.

- [ ] **Step 6: Commit**

```bash
git add components/auth/ app/auth/
git commit -m "feat: login and signup pages with Supabase Auth"
```

---

## Task 18: Sample Contracts Seed Script

**Files:**
- Create: `scripts/seed-contracts.ts`

- [ ] **Step 1: Create the seed script**

```typescript
// scripts/seed-contracts.ts
// Run with: npx ts-node scripts/seed-contracts.ts
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // service role bypasses RLS
)

const ADMIN_USER_ID = process.env.SEED_ADMIN_USER_ID! // set this after creating an admin account

async function seed() {
  // Get category IDs
  const { data: cats } = await supabase.from('categories').select('id, slug')
  const catMap = Object.fromEntries((cats ?? []).map((c) => [c.slug, c.id]))

  const contracts = [
    {
      slug: 'power-outage-cdmx-2h',
      title: 'Power outage in CDMX of more than 2 hours?',
      category_id: catMap['urban'],
      trigger_type: 'manual',
      trigger_condition: { type: 'power_outage', min_duration_hours: 2 },
      trigger_deadline: '2026-01-31T23:59:59Z',
      location: { lat: 19.4326, lng: -99.1332, city: 'CDMX', country: 'MX' },
      icon_url: null,
      total_volume_usd: 9_000_000,
      is_featured: true,
      tiers: [
        { name: 'basic',   premium_usd: 100, payout_usd: 500,  base_probability: 0.18 },
        { name: 'premium', premium_usd: 600, payout_usd: 1700, base_probability: 0.18 },
      ],
    },
    {
      slug: 'waze-heavy-traffic-cdmx',
      title: 'Unusually heavy traffic as reported by Waze?',
      category_id: catMap['urban'],
      trigger_type: 'urban',
      trigger_condition: { type: 'traffic', source: 'waze', index_threshold: 8 },
      trigger_deadline: '2026-06-30T23:59:59Z',
      location: { lat: 19.4326, lng: -99.1332, city: 'CDMX', country: 'MX' },
      icon_url: null,
      total_volume_usd: 9_000_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 50,  payout_usd: 200,  base_probability: 0.22 },
        { name: 'premium', premium_usd: 800, payout_usd: 2200, base_probability: 0.22 },
      ],
    },
    {
      slug: 'earthquakes-7-june-30',
      title: 'How many 7.0+ earthquakes by June 30?',
      category_id: catMap['nature'],
      trigger_type: 'weather',
      trigger_condition: { type: 'earthquake', min_magnitude: 7.0, operator: 'count' },
      trigger_deadline: '2026-06-30T23:59:59Z',
      location: { lat: 19.4326, lng: -99.1332, city: 'CDMX', country: 'MX' },
      icon_url: null,
      total_volume_usd: 583_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 400,  payout_usd: 8000, base_probability: 0.05 },
        { name: 'premium', premium_usd: 1000, payout_usd: 4000, base_probability: 0.12 },
      ],
    },
    {
      slug: 'whistler-snow-20cm',
      title: 'Less than 20 cm of snow in Whistler?',
      category_id: catMap['experiences'],
      trigger_type: 'weather',
      trigger_condition: { metric: 'snow_cm', threshold: 20, operator: 'lt' },
      trigger_deadline: '2026-03-31T23:59:59Z',
      location: { lat: 50.1163, lng: -122.9574, city: 'Whistler', country: 'CA' },
      icon_url: null,
      total_volume_usd: 98_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 1800, payout_usd: 7000,  base_probability: 0.24 },
        { name: 'premium', premium_usd: 4000, payout_usd: 16000, base_probability: 0.24 },
      ],
    },
    {
      slug: 'bad-bunny-cancelled',
      title: 'Bad Bunny concert cancelled?',
      category_id: catMap['events'],
      trigger_type: 'manual',
      trigger_condition: { type: 'event_cancellation', event_name: 'Bad Bunny Concert' },
      trigger_deadline: '2026-12-31T23:59:59Z',
      location: { lat: 19.4326, lng: -99.1332, city: 'CDMX', country: 'MX' },
      icon_url: null,
      total_volume_usd: 9_000_000,
      is_featured: true,
      tiers: [
        { name: 'basic',   premium_usd: 200,  payout_usd: 1400, base_probability: 0.04 },
        { name: 'premium', premium_usd: 1000, payout_usd: 4000, base_probability: 0.04 },
      ],
    },
  ]

  for (const c of contracts) {
    const { tiers, ...contractData } = c
    const { data: contract, error } = await supabase
      .from('contracts')
      .insert({ ...contractData, created_by: ADMIN_USER_ID })
      .select()
      .single()

    if (error) {
      console.error(`Failed to insert contract "${c.slug}":`, error.message)
      continue
    }

    for (const tier of tiers) {
      const { error: tierErr } = await supabase
        .from('coverage_tiers')
        .insert({ ...tier, contract_id: contract.id })

      if (tierErr) console.error(`Tier error for ${c.slug}:`, tierErr.message)
    }

    console.log(`✓ Created: ${c.slug}`)
  }

  console.log('\nSeed complete.')
}

seed().catch(console.error)
```

- [ ] **Step 2: Add SEED_ADMIN_USER_ID to .env.local.example**

Add to `.env.local.example`:
```
SEED_ADMIN_USER_ID=your_admin_user_uuid_here
```

- [ ] **Step 3: Create an admin account, then run the seed**

1. Sign up at `http://localhost:3000/auth/signup`
2. Confirm email
3. Get your user UUID from Supabase Dashboard → Authentication → Users
4. Set `SEED_ADMIN_USER_ID` in `.env.local`
5. Run:

```bash
npx ts-node --project tsconfig.json scripts/seed-contracts.ts
```

Expected:
```
✓ Created: power-outage-cdmx-2h
✓ Created: waze-heavy-traffic-cdmx
✓ Created: earthquakes-7-june-30
✓ Created: whistler-snow-20cm
✓ Created: bad-bunny-cancelled

Seed complete.
```

- [ ] **Step 4: Reload the browse page and verify cards appear**

Open `http://localhost:3000`. Expected: all 5 contracts appear in their correct category sections with pricing rows.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-contracts.ts .env.local.example
git commit -m "feat: sample contracts seed script with 5 contracts across 4 categories"
```

---

## Task 19: Run All Tests

- [ ] **Step 1: Run the full test suite**

```bash
npm run test:run
```

Expected output:
```
✓ tests/lib/utils.test.ts (5 tests)
✓ tests/components/Header.test.tsx (4 tests)
✓ tests/components/CategoryTabs.test.tsx (3 tests)
✓ tests/components/StatsBar.test.tsx (4 tests)
✓ tests/components/ContractCard.test.tsx (5 tests)

Test Files  5 passed (5)
Tests       21 passed (21)
```

- [ ] **Step 2: Fix any failures before continuing**

If tests fail due to import errors, verify `vitest.config.ts` has the `@` alias set to the project root.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: all 21 unit tests passing — components, utils, types"
```

---

## Task 20: Playwright E2E Smoke Test

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/browse.spec.ts`

- [ ] **Step 1: Create Playwright config**

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
  },
})
```

- [ ] **Step 2: Write the smoke test**

```typescript
// tests/e2e/browse.spec.ts
import { test, expect } from '@playwright/test'

test('browse page loads with all required elements', async ({ page }) => {
  await page.goto('/')

  // Header
  await expect(page.getByText('INSU')).toBeVisible()
  await expect(page.getByRole('link', { name: /log in/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /sign up/i })).toBeVisible()

  // Category tabs
  await expect(page.getByRole('tab', { name: /urban/i })).toBeVisible()
  await expect(page.getByRole('tab', { name: /nature/i })).toBeVisible()
  await expect(page.getByRole('tab', { name: /experiences/i })).toBeVisible()
  await expect(page.getByRole('tab', { name: /events/i })).toBeVisible()
})

test('clicking a category tab filters contracts', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: /nature/i }).click()

  // Nature section should be visible, Urban should not be the first section
  await expect(page.getByText('🌿 Nature')).toBeVisible()
})

test('buy now button is present on contract cards', async ({ page }) => {
  await page.goto('/')

  // At least one Buy now button should appear if contracts are seeded
  const buyButtons = page.getByRole('button', { name: /buy now/i })
  const count = await buyButtons.count()
  expect(count).toBeGreaterThan(0)
})
```

- [ ] **Step 3: Run e2e tests (requires dev server running)**

```bash
npx playwright install chromium
npx playwright test
```

Expected: `3 passed`

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e/
git commit -m "test: Playwright e2e smoke tests for browse page"
```

---

## Done — Sub-project 1 Complete

At this point you have:
- ✅ Next.js 14 app scaffolded with Tailwind, shadcn/ui, TypeScript
- ✅ Full Supabase schema (9 tables, RLS, indexes, auth trigger)
- ✅ Categories seeded
- ✅ Supabase browser + server clients + session middleware
- ✅ Header, CategoryTabs, StatsBar, ContractCard, ContractSection components
- ✅ Browse page (`/`) with server-side data fetching + Realtime live updates
- ✅ Login and Signup pages with Supabase Auth
- ✅ Sample contracts seeded (5 contracts, 4 categories)
- ✅ 21 unit tests passing + Playwright e2e smoke test

**Next:** `docs/superpowers/plans/2026-05-10-insu-sp2-contract-detail-purchase.md` — Contract detail page, hedger buy flow, risk provider deposit flow, Stripe + Conekta integration.
