import { render } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import AdminTriggerPage from '@/app/admin/trigger/page'

// The trigger override page reads hedger_positions, which is own-only under RLS.
// A user-scoped read would surface only the admin's own positions and under-count
// buyer exposure, so the page must read restricted data via the service client.

// Chainable + awaitable query builder that resolves to `result` at any await point.
function builder(result: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'is']) b[m] = () => b
  b.single = () => Promise.resolve(result)
  b.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return b
}

const userFrom = vi.fn((table: string) => {
  if (table === 'profiles') return builder({ data: { role: 'admin' } })
  return builder({ data: null })
})

const serviceFrom = vi.fn((table: string) => {
  if (table === 'contracts') {
    return builder({ data: [{ id: 'c1', slug: 'mx-rain', status: 'active' }] })
  }
  if (table === 'hedger_positions') {
    return builder({ data: [{ payout_amount_usd: 100 }, { payout_amount_usd: 150 }] })
  }
  if (table === 'oracle_readings') {
    return builder({ data: { trigger_met: true, value: {}, read_at: '2026-06-22T00:00:00Z' } })
  }
  return builder({ data: null })
})

const createServiceClient = vi.fn(() => ({ from: serviceFrom }))
const createClient = vi.fn(async () => ({
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } } }) },
  from: userFrom,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => createServiceClient(),
  createClient: () => createClient(),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

describe('AdminTriggerPage', () => {
  beforeEach(() => {
    userFrom.mockClear()
    serviceFrom.mockClear()
    createServiceClient.mockClear()
  })

  it('reads contracts and hedger_positions via the service-role client', async () => {
    render(await AdminTriggerPage({ searchParams: Promise.resolve({}) }))
    expect(createServiceClient).toHaveBeenCalled()
    const serviceTables = serviceFrom.mock.calls.map((c) => c[0])
    expect(serviceTables).toContain('contracts')
    expect(serviceTables).toContain('hedger_positions')
  })

  it('never reads hedger_positions through the user-scoped client', async () => {
    render(await AdminTriggerPage({ searchParams: Promise.resolve({}) }))
    const userTables = userFrom.mock.calls.map((c) => c[0])
    expect(userTables).not.toContain('hedger_positions')
  })
})
