# Oracle Scenario Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/admin/scenario` — an admin page for injecting manual oracle readings to simulate trigger conditions for demos and testing.

**Architecture:** Server action (`injectReading`) validates JSON, evaluates the trigger, and inserts an `oracle_readings` row. A client form component (`ScenarioPanel`) renders the contract selector, JSON textarea, and inline result card. The admin sidebar gets a new "Scenario" entry, and the Trigger page gains URL-param pre-selection so the result card can link directly to the right contract.

**Tech Stack:** Next.js 14 App Router, Supabase (server client), `evaluateTrigger` from `lib/oracle/trigger.ts`, `useTransition` for async action, Vitest for unit tests.

---

### Task 1: `injectReading` server action (TDD)

**Files:**
- Create: `lib/actions/oracle/injectReading.ts`
- Create: `tests/lib/actions/oracle/injectReading.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/actions/oracle/injectReading.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Must be hoisted — vi.mock factory runs before imports
const mockGetUser = vi.hoisted(() => vi.fn())
const mockFrom = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser }, from: mockFrom }),
  createServiceClient: () => ({ from: mockFrom }),
}))

vi.mock('@/lib/oracle/trigger', () => ({
  evaluateTrigger: vi.fn((condition: { operator: string; threshold: number }, value: Record<string, unknown>) => {
    const actual = value[condition.metric as string]
    if (typeof actual !== 'number') return false
    if (condition.operator === 'gte') return actual >= condition.threshold
    if (condition.operator === 'lte') return actual <= condition.threshold
    if (condition.operator === 'gt') return actual > condition.threshold
    return actual < condition.threshold
  }),
}))

import { injectReading } from '@/lib/actions/oracle/injectReading'

const ADMIN_USER = { id: 'admin-1' }
const CONTRACT = {
  id: 'c1',
  slug: 'rain-cdmx',
  status: 'active',
  settled_outcome: null,
  trigger_condition: { metric: 'precipitation_mm', threshold: 30, operator: 'gte' },
}

function makeSupabaseChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'single', 'insert']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  ;(chain.single as ReturnType<typeof vi.fn>).mockResolvedValue(returnValue)
  ;(chain.insert as ReturnType<typeof vi.fn>).mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'reading-1' }, error: null }),
    }),
  })
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: ADMIN_USER }, error: null })
})

describe('injectReading', () => {
  it('returns error for invalid JSON', async () => {
    const result = await injectReading('c1', 'not json', 'manual')
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Invalid JSON') })
  })

  it('returns error when contract not found', async () => {
    mockFrom.mockReturnValue(makeSupabaseChain({ data: null, error: { message: 'not found' } }))
    const result = await injectReading('bad-id', '{"x":1}', 'manual')
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('not found') })
  })

  it('returns error when contract already settled', async () => {
    const settled = { ...CONTRACT, settled_outcome: true }
    mockFrom.mockReturnValue(makeSupabaseChain({ data: settled, error: null }))
    const result = await injectReading('c1', '{"precipitation_mm":45}', 'manual')
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('already settled') })
  })

  it('evaluates trigger_met correctly (above threshold)', async () => {
    const chain = makeSupabaseChain({ data: CONTRACT, error: null })
    mockFrom.mockReturnValue(chain)
    const result = await injectReading('c1', '{"precipitation_mm":45}', 'manual')
    expect(result).toMatchObject({
      ok: true,
      trigger_met: true,
      metric: 'precipitation_mm',
      operator: 'gte',
      threshold: 30,
      actual_value: 45,
    })
  })

  it('evaluates trigger_met correctly (below threshold)', async () => {
    const chain = makeSupabaseChain({ data: CONTRACT, error: null })
    mockFrom.mockReturnValue(chain)
    const result = await injectReading('c1', '{"precipitation_mm":10}', 'manual')
    expect(result).toMatchObject({ ok: true, trigger_met: false, actual_value: 10 })
  })

  it('returns the reading_id on success', async () => {
    const chain = makeSupabaseChain({ data: CONTRACT, error: null })
    mockFrom.mockReturnValue(chain)
    const result = await injectReading('c1', '{"precipitation_mm":45}', 'manual')
    expect(result).toMatchObject({ ok: true, reading_id: 'reading-1' })
  })
})
```

- [ ] **Step 2: Run test — expect FAIL (module not found)**

```bash
npx vitest run tests/lib/actions/oracle/injectReading.test.ts
```

Expected: fail with `Cannot find module '@/lib/actions/oracle/injectReading'`

- [ ] **Step 3: Implement `injectReading`**

Create `lib/actions/oracle/injectReading.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { evaluateTrigger, type TriggerCondition } from '@/lib/oracle/trigger'

export interface InjectResult {
  ok: true
  trigger_met: boolean
  metric: string
  operator: string
  threshold: number
  actual_value: number
  reading_id: string
  contract_slug: string
}

export async function injectReading(
  contractId: string,
  valueJson: string,
  source: string,
): Promise<InjectResult | { ok: false; error: string }> {
  let parsedValue: Record<string, unknown>
  try {
    parsedValue = JSON.parse(valueJson)
  } catch {
    return { ok: false, error: 'Invalid JSON — check your reading value' }
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized' }

  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .select('id, slug, status, settled_outcome, trigger_condition')
    .eq('id', contractId)
    .single()

  if (contractError || !contract) return { ok: false, error: 'Contract not found' }
  if ((contract as { settled_outcome: unknown }).settled_outcome !== null) {
    return { ok: false, error: 'Contract already settled' }
  }

  const condition = (contract as { trigger_condition: unknown }).trigger_condition as TriggerCondition
  const trigger_met = condition?.metric ? evaluateTrigger(condition, parsedValue) : false
  const actual_value = typeof parsedValue[condition?.metric] === 'number'
    ? parsedValue[condition.metric] as number
    : 0

  const { data: reading, error: insertError } = await supabase
    .from('oracle_readings')
    .insert({
      contract_id: contractId,
      source,
      reading_type: 'manual',
      value: parsedValue,
      trigger_met,
    })
    .select('id')
    .single()

  if (insertError || !reading) return { ok: false, error: 'Failed to write reading' }

  return {
    ok: true,
    trigger_met,
    metric: condition.metric,
    operator: condition.operator,
    threshold: condition.threshold,
    actual_value,
    reading_id: (reading as { id: string }).id,
    contract_slug: (contract as { slug: string }).slug,
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/lib/actions/oracle/injectReading.test.ts
```

Expected: 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/actions/oracle/injectReading.ts tests/lib/actions/oracle/injectReading.test.ts
git commit -m "feat: add injectReading server action with trigger evaluation"
```

---

### Task 2: Admin sidebar + Trigger page pre-selection

**Files:**
- Modify: `components/admin/AdminSidebar.tsx`
- Modify: `app/admin/trigger/page.tsx`
- Modify: `components/admin/trigger/TriggerOverride.tsx`

- [ ] **Step 1: Add Scenario to admin sidebar**

Edit `components/admin/AdminSidebar.tsx` — add entry after Oracle:

```ts
const NAV = [
  { href: '/admin/contracts', label: 'Contracts', icon: '📋' },
  { href: '/admin/trigger',   label: 'Trigger',   icon: '⚡' },
  { href: '/admin/oracle',    label: 'Oracle',    icon: '🌐' },
  { href: '/admin/scenario',  label: 'Scenario',  icon: '🧪' },
  { href: '/admin/payouts',   label: 'Payouts',   icon: '💸' },
] as const
```

- [ ] **Step 2: Add `initialContractId` prop to TriggerOverride**

Edit `components/admin/trigger/TriggerOverride.tsx`:

```ts
// Change Props interface to:
interface Props {
  contracts: Contract[]
  summaries: ContractSummary[]
  initialContractId?: string
}

// Change component signature to:
export function TriggerOverride({ contracts, summaries, initialContractId }: Props) {
  const [contractId, setContractId] = useState(initialContractId ?? '')
  // rest unchanged
```

- [ ] **Step 3: Read searchParam in trigger page and resolve slug → id**

Edit `app/admin/trigger/page.tsx` — add `searchParams` prop and resolve slug to contract id:

```ts
export default async function AdminTriggerPage({
  searchParams,
}: {
  searchParams: { contract?: string }
}) {
  const supabase = createClient()

  const { data: contracts } = await supabase
    .from('contracts')
    .select('*')
    .eq('status', 'active')
    .order('trigger_deadline')

  const activeContracts = (contracts ?? []) as unknown as Contract[]

  // resolve ?contract=<slug> to an id
  const initialContractId = searchParams.contract
    ? (activeContracts.find((c) => c.slug === searchParams.contract)?.id ?? '')
    : ''

  const summaries = await Promise.all(
    activeContracts.map(async (contract) => {
      const { data: positions } = await supabase
        .from('hedger_positions')
        .select('payout_amount_usd')
        .eq('contract_id', contract.id)
        .eq('status', 'active')

      const hedgers = (positions ?? []) as Pick<HedgerPosition, 'payout_amount_usd'>[]
      const totalPayout = hedgers.reduce((sum, p) => sum + p.payout_amount_usd, 0)

      const { data: reading } = await supabase
        .from('oracle_readings')
        .select('trigger_met, value, read_at')
        .eq('contract_id', contract.id)
        .order('read_at', { ascending: false })
        .limit(1)
        .single()

      const r = reading as { trigger_met: boolean; value: Record<string, unknown>; read_at: string } | null

      return {
        contract,
        hedgerCount: hedgers.length,
        totalPayout,
        oracleStatus: r ? (r.trigger_met ? 'TRIGGERED' : 'NO TRIGGER') : 'NO READINGS',
        lastValue: r ? JSON.stringify(r.value).slice(0, 40) : '—',
      }
    }),
  )

  return <TriggerOverride contracts={activeContracts} summaries={summaries} initialContractId={initialContractId} />
}
```

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add components/admin/AdminSidebar.tsx components/admin/trigger/TriggerOverride.tsx app/admin/trigger/page.tsx
git commit -m "feat: add Scenario to admin sidebar, support ?contract= pre-selection on Trigger page"
```

---

### Task 3: ScenarioPanel client component

**Files:**
- Create: `components/admin/scenario/ScenarioPanel.tsx`

- [ ] **Step 1: Implement ScenarioPanel**

Create `components/admin/scenario/ScenarioPanel.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { injectReading, type InjectResult } from '@/lib/actions/oracle/injectReading'
import type { Contract } from '@/lib/types'
import type { TriggerCondition } from '@/lib/oracle/trigger'

interface Props {
  contracts: Contract[]
}

const inputCls = 'w-full rounded-md border border-white/[0.07] bg-bg px-3 py-2 text-sm text-insu-text focus:border-insu-accent/40 focus:outline-none'
const labelCls = 'mb-1 block text-[11px] uppercase tracking-wider text-insu-muted'

function operatorSymbol(op: string) {
  return op === 'gte' ? '≥' : op === 'lte' ? '≤' : op === 'gt' ? '>' : '<'
}

function defaultJson(condition: TriggerCondition | null): string {
  if (!condition?.metric) return '{}'
  return JSON.stringify({ [condition.metric]: condition.threshold }, null, 2)
}

export function ScenarioPanel({ contracts }: Props) {
  const [contractId, setContractId] = useState('')
  const [valueJson, setValueJson] = useState('{}')
  const [source, setSource] = useState('manual')
  const [result, setResult] = useState<InjectResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const selectedContract = contracts.find((c) => c.id === contractId)
  const condition = selectedContract
    ? (selectedContract.trigger_condition as unknown as TriggerCondition)
    : null

  function handleContractChange(id: string) {
    setContractId(id)
    setResult(null)
    setError(null)
    const contract = contracts.find((c) => c.id === id)
    const cond = contract ? (contract.trigger_condition as unknown as TriggerCondition) : null
    setValueJson(defaultJson(cond))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!contractId) return
    setError(null)
    setResult(null)

    startTransition(async () => {
      const res = await injectReading(contractId, valueJson, source || 'manual')
      if (!res.ok) {
        setError(res.error)
      } else {
        setResult(res)
      }
    })
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-1 font-display text-2xl tracking-wide text-insu-text">Scenario Panel</h1>
      <p className="mb-6 text-sm text-insu-muted">
        Inject a manual oracle reading to simulate a trigger condition — for demos and testing.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className={labelCls}>Contract</label>
          <select
            className={inputCls + ' cursor-pointer'}
            value={contractId}
            onChange={(e) => handleContractChange(e.target.value)}
            required
          >
            <option value="">Select a contract…</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {new Date(c.trigger_deadline).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>

        {condition && (
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-3">
            <p className={labelCls}>Trigger condition</p>
            <p className="font-mono text-sm text-insu-text">
              {condition.metric}{' '}
              <span className="text-insu-accent">{operatorSymbol(condition.operator)}</span>{' '}
              {condition.threshold}
            </p>
          </div>
        )}

        <div>
          <label className={labelCls}>Reading value (JSON)</label>
          <textarea
            className={inputCls + ' font-mono'}
            rows={5}
            value={valueJson}
            onChange={(e) => setValueJson(e.target.value)}
            spellCheck={false}
            required
          />
        </div>

        <div>
          <label className={labelCls}>Source label</label>
          <input
            className={inputCls}
            type="text"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="manual"
          />
        </div>

        {error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!contractId || isPending}
          className="w-full rounded-md bg-insu-accent py-2.5 text-sm font-bold tracking-wide text-bg disabled:opacity-40 hover:bg-[#f7b84a]"
        >
          {isPending ? 'Injecting…' : 'Inject Reading'}
        </button>
      </form>

      {result && (
        <div className="mt-6 rounded-lg border border-white/[0.07] bg-white/[0.02] p-5 space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-insu-muted">
            ✓ Reading written
          </p>

          {result.trigger_met ? (
            <div className="space-y-1">
              <p className="text-sm font-bold text-insu-green">TRIGGER MET: YES</p>
              <p className="font-mono text-sm text-insu-dim">
                {result.metric} = {result.actual_value}{' '}
                <span className="text-insu-accent">{operatorSymbol(result.operator)}</span>{' '}
                threshold {result.threshold}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-bold text-insu-dim">TRIGGER NOT MET</p>
              <p className="font-mono text-sm text-insu-dim">
                {result.metric} = {result.actual_value}{' '}
                <span className="text-insu-accent">{operatorSymbol(result.operator)}</span>{' '}
                threshold {result.threshold} ✗
              </p>
              <p className="text-xs text-insu-muted">
                Trigger condition was not satisfied — contract remains active.
              </p>
            </div>
          )}

          <Link
            href={`/admin/trigger?contract=${result.contract_slug}`}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-insu-accent/30 bg-insu-accent/5 px-4 py-2 text-sm font-semibold text-insu-accent hover:bg-insu-accent/10 transition-colors"
          >
            Settle this contract now →
          </Link>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/admin/scenario/ScenarioPanel.tsx
git commit -m "feat: add ScenarioPanel client component"
```

---

### Task 4: `/admin/scenario` page

**Files:**
- Create: `app/admin/scenario/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/admin/scenario/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server'
import { ScenarioPanel } from '@/components/admin/scenario/ScenarioPanel'
import type { Contract } from '@/lib/types'

export default async function AdminScenarioPage() {
  const supabase = createClient()

  const { data: contracts } = await supabase
    .from('contracts')
    .select('id, slug, title, trigger_type, trigger_condition, trigger_deadline')
    .eq('status', 'active')
    .is('settled_outcome', null)
    .order('trigger_deadline')

  const activeContracts = (contracts ?? []) as unknown as Contract[]

  return <ScenarioPanel contracts={activeContracts} />
}
```

- [ ] **Step 2: Full test suite + type check**

```bash
npx vitest run && npx tsc --noEmit
```

Expected: all tests pass, no type errors

- [ ] **Step 3: Commit**

```bash
git add app/admin/scenario/page.tsx
git commit -m "feat: add /admin/scenario page"
```

---

### Task 5: Push and deploy

- [ ] **Step 1: Push to origin**

```bash
git push origin main
```

- [ ] **Step 2: Deploy to production**

```bash
vercel --prod
```

- [ ] **Step 3: Smoke test**

Visit `https://insu-gbd-ev-ops-projects.vercel.app/admin/scenario` — confirm the page loads, contract selector shows active contracts, JSON textarea pre-fills on contract select, and "Inject Reading" button is present.
