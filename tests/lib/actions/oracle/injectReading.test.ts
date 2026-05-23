import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockFrom = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser }, from: mockFrom }),
  createServiceClient: () => ({ from: mockFrom }),
}))

vi.mock('@/lib/oracle/trigger', () => ({
  evaluateTrigger: vi.fn((condition: { metric: string; operator: string; threshold: number }, value: Record<string, unknown>) => {
    const actual = value[condition.metric]
    if (typeof actual !== 'number') return false
    if (condition.operator === 'gte') return actual >= condition.threshold
    if (condition.operator === 'lte') return actual <= condition.threshold
    if (condition.operator === 'gt') return actual > condition.threshold
    return actual < condition.threshold
  }),
}))

import { injectReading } from '@/lib/actions/oracle/injectReading'

const CONTRACT = {
  id: 'c1',
  slug: 'rain-cdmx',
  status: 'active',
  settled_outcome: null,
  trigger_condition: { metric: 'precipitation_mm', threshold: 30, operator: 'gte' },
}

function makeChain(singleValue: unknown) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.single = vi.fn().mockResolvedValue(singleValue)
  chain.insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'reading-1' }, error: null }),
    }),
  })
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
})

describe('injectReading', () => {
  it('returns error for invalid JSON', async () => {
    const result = await injectReading('c1', 'not json', 'manual')
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Invalid JSON') })
  })

  it('returns error when contract not found', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'not found' } }))
    const result = await injectReading('bad-id', '{"x":1}', 'manual')
    expect(result).toMatchObject({ ok: false, error: 'Contract not found' })
  })

  it('returns error when contract already settled', async () => {
    mockFrom.mockReturnValue(makeChain({ data: { ...CONTRACT, settled_outcome: true }, error: null }))
    const result = await injectReading('c1', '{"precipitation_mm":45}', 'manual')
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('already settled') })
  })

  it('evaluates trigger_met correctly (above threshold)', async () => {
    mockFrom.mockReturnValue(makeChain({ data: CONTRACT, error: null }))
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
    mockFrom.mockReturnValue(makeChain({ data: CONTRACT, error: null }))
    const result = await injectReading('c1', '{"precipitation_mm":10}', 'manual')
    expect(result).toMatchObject({ ok: true, trigger_met: false, actual_value: 10 })
  })

  it('returns the reading_id on success', async () => {
    mockFrom.mockReturnValue(makeChain({ data: CONTRACT, error: null }))
    const result = await injectReading('c1', '{"precipitation_mm":45}', 'manual')
    expect(result).toMatchObject({ ok: true, reading_id: 'reading-1' })
  })
})
