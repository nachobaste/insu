import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import AdminPayoutsPage from '@/app/admin/payouts/page'

// The admin payouts view must read through the service-role client, because the
// "Own payouts" RLS policy hides every payout that the viewing admin doesn't own.
// These mocks assert the page does NOT depend on the user-scoped client for data.

const payoutRow = {
  id: 'payout-1',
  amount_usd: 250,
  status: 'completed',
  created_at: '2026-06-22T00:00:00.000Z',
  transfer_id: 'txn_abc',
  contract: { title: 'Mexico City Rain' },
  hedger_position: { profile: { full_name: 'Jane Buyer' } },
}

const createServiceClient = vi.fn()
const createClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => createServiceClient(),
  createClient: () => createClient(),
}))

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

function userClientReturningAdmin() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } } }) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { role: 'admin' } }),
        })),
      })),
    })),
  }
}

function serviceClientReturningPayouts(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn().mockResolvedValue({ data: rows }),
      })),
    })),
  }
}

describe('AdminPayoutsPage', () => {
  beforeEach(() => {
    createClient.mockResolvedValue(userClientReturningAdmin())
    createServiceClient.mockReturnValue(serviceClientReturningPayouts([payoutRow]))
  })

  it('reads payouts via the service-role client (bypassing RLS)', async () => {
    render(await AdminPayoutsPage())
    expect(createServiceClient).toHaveBeenCalled()
  })

  it('renders a completed payout the admin does not own', async () => {
    render(await AdminPayoutsPage())
    expect(screen.getByText('Mexico City Rain')).toBeInTheDocument()
    expect(screen.getByText('Jane Buyer')).toBeInTheDocument()
    expect(screen.getByText('$250 USD')).toBeInTheDocument()
  })
})
