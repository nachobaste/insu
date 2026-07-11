import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PayoutsTab } from '@/components/dashboard/PayoutsTab'
import type { PayoutWithContract, HedgerPositionWithContract } from '@/lib/types'

function makePayout(overrides: Partial<PayoutWithContract> = {}): PayoutWithContract {
  return {
    id: 'payout-1',
    contract_id: 'contract-1',
    hedger_position_id: 'pos-1',
    amount_usd: 100,
    amount_mxn: 2000,
    currency: 'USD',
    payment_provider: 'stripe',
    transfer_id: null,
    status: 'completed',
    created_at: '2026-07-01T12:00:00Z',
    completed_at: '2026-07-01T12:05:00Z',
    contract: {
      id: 'contract-1',
      slug: 'test-contract',
      title: 'Test Contract',
      status: 'active',
    },
    ...overrides,
  }
}

function makePosition(overrides: Partial<HedgerPositionWithContract> = {}): HedgerPositionWithContract {
  return {
    id: 'pos-1',
    user_id: 'user-1',
    contract_id: 'contract-1',
    tier_id: 'tier-1',
    premium_paid_usd: 50,
    payout_amount_usd: 500,
    premium_paid_mxn: 1000,
    payout_amount_mxn: 10000,
    currency: 'USD',
    payment_provider: 'stripe',
    payment_intent_id: null,
    status: 'active',
    purchased_at: '2026-06-24T12:00:00Z',
    expires_at: '2026-07-24T12:00:00Z',
    contract: {
      id: 'contract-1',
      slug: 'test-contract',
      title: 'Test Contract',
      trigger_type: 'urban',
      status: 'active',
      is_recurring: true,
      trigger_condition: { speed_kmh: { lt: 15 } },
    },
    tier: {
      name: 'basic',
      base_probability: 0.05,
      max_payouts: 30,
    },
    ...overrides,
  }
}

describe('PayoutsTab PnL summary', () => {
  it('shows a positive net with + prefix and green color when payouts exceed spend', () => {
    // received 100+100=200, spent 50 → net +150
    render(
      <PayoutsTab
        payouts={[makePayout({ id: 'a' }), makePayout({ id: 'b' })]}
        hedgerPositions={[makePosition()]}
      />,
    )

    expect(screen.getByText('Received')).toBeInTheDocument()
    expect(screen.getByText('$200 USD')).toBeInTheDocument()
    expect(screen.getByText('Spent')).toBeInTheDocument()
    expect(screen.getByText('$50 USD')).toBeInTheDocument()
    const net = screen.getByText('+$150 USD')
    expect(net).toBeInTheDocument()
    expect(net.className).toContain('text-insu-green')
  })

  it('shows a negative net in red when spend exceeds payouts', () => {
    // received 100, spent 50+120=170 → net -70
    render(
      <PayoutsTab
        payouts={[makePayout()]}
        hedgerPositions={[
          makePosition({ id: 'p1' }),
          makePosition({ id: 'p2', premium_paid_usd: 120 }),
        ]}
      />,
    )

    const net = screen.getByText('-$70 USD')
    expect(net).toBeInTheDocument()
    expect(net.className).toContain('text-red-400')
  })

  it('includes processing payouts in the received total', () => {
    // completed 100 + processing 250 = 350 received, spent 50 → net +300
    render(
      <PayoutsTab
        payouts={[
          makePayout({ id: 'a' }),
          makePayout({ id: 'b', amount_usd: 250, status: 'processing', completed_at: null }),
        ]}
        hedgerPositions={[makePosition()]}
      />,
    )

    expect(screen.getByText('$350 USD')).toBeInTheDocument()
    expect(screen.getByText('+$300 USD')).toBeInTheDocument()
  })

  it('renders the strip and the empty message when the user has spend but no payouts', () => {
    render(<PayoutsTab payouts={[]} hedgerPositions={[makePosition()]} />)

    expect(screen.getByText('Spent')).toBeInTheDocument()
    expect(screen.getByText('-$50 USD')).toBeInTheDocument()
    expect(screen.getByText(/No payouts yet/)).toBeInTheDocument()
  })

  it('renders only the empty message when there are no positions and no payouts', () => {
    render(<PayoutsTab payouts={[]} hedgerPositions={[]} />)

    expect(screen.queryByText('Received')).not.toBeInTheDocument()
    expect(screen.queryByText('Net')).not.toBeInTheDocument()
    expect(screen.getByText(/No payouts yet/)).toBeInTheDocument()
  })
})
