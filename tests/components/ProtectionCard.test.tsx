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

    // formatCurrency uses maximumFractionDigits: 0 and appends the code, so 204.76 → $205 USD
    expect(screen.getByText('$205 USD')).toBeInTheDocument()
    expect(screen.getByText(/Current value:/)).toBeInTheDocument()
  })

  it('does NOT render a "Current value" line when current_value_usd is null', () => {
    const position = makePosition({ current_value_usd: null })
    render(<ProtectionCard position={position} />)

    expect(screen.queryByText(/Current value:/)).not.toBeInTheDocument()
  })

  describe('covered dates', () => {
    it('shows the covered rush-window days for a corridor position', () => {
      const position = makePosition({
        purchased_at: '2026-07-10T18:00:00Z', // 12:00 market-local (UTC-6)
        expires_at: '2026-07-17T18:00:00Z',   // 7×24h later
        contract: {
          ...makePosition().contract,
          corridor: { window_start: '06:00:00', window_end: '10:00:00' },
        },
      })
      render(<ProtectionCard position={position} />)

      // Jul 10's 6–10am window is already past at purchase, so coverage starts Jul 11.
      expect(screen.getByText(/the 6–10am window daily, Jul 11 – Jul 17/)).toBeInTheDocument()
    })

    it('shows a plain coverage range for a recurring non-corridor position', () => {
      const position = makePosition({
        purchased_at: '2026-07-10T18:00:00Z',
        expires_at: '2026-08-09T18:00:00Z', // 30×24h later
      })
      render(<ProtectionCard position={position} />)

      expect(screen.getByText(/Jul 10, 12pm – Aug 9, 12pm/)).toBeInTheDocument()
    })

    it('does NOT show covered dates for a non-recurring contract', () => {
      const position = makePosition({
        contract: { ...makePosition().contract, is_recurring: false },
      })
      render(<ProtectionCard position={position} />)

      expect(screen.queryByText(/Protects/)).not.toBeInTheDocument()
    })
  })
})
