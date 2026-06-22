import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ProtectionCard } from '@/components/dashboard/ProtectionCard'
import type { HedgerPositionWithContract } from '@/lib/types'

function makePosition(overrides: Partial<HedgerPositionWithContract> = {}): HedgerPositionWithContract {
  const now = Date.now()
  const purchased_at = new Date(now - 7 * 86_400_000).toISOString()   // 7 days ago
  const expires_at   = new Date(now + 23 * 86_400_000).toISOString()  // 23 days from now

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
    purchased_at,
    expires_at,
    contract: {
      id: 'contract-1',
      slug: 'test-contract',
      title: 'Test Recurring Protection',
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

describe('ProtectionCard', () => {
  it('shows live current value for an active position with current_value_usd', () => {
    const position = makePosition({ current_value_usd: 204.76 })
    render(<ProtectionCard position={position} />)

    // formatCurrency uses maximumFractionDigits: 0, so 204.76 → $205
    expect(screen.getByText('$205')).toBeInTheDocument()
    expect(screen.getByText(/Current value:/)).toBeInTheDocument()
  })

  it('does NOT render a "Current value" line when current_value_usd is null', () => {
    const position = makePosition({ current_value_usd: null })
    render(<ProtectionCard position={position} />)

    expect(screen.queryByText(/Current value:/)).not.toBeInTheDocument()
  })
})
