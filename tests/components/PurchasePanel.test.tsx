import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import PurchasePanel from '@/components/markets/PurchasePanel'
import type { ContractWithTiers } from '@/lib/types'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/lib/actions/purchase', () => ({
  createHedgerPaymentIntent: vi.fn().mockResolvedValue({ clientSecret: 'pi_test_secret' }),
  createProviderPaymentIntent: vi.fn().mockResolvedValue({ clientSecret: 'pi_test_secret' }),
}))

vi.mock('@/components/markets/StripePaymentForm', () => ({
  default: () => <div data-testid="stripe-form" />,
}))

const mockContract: ContractWithTiers = {
  id: 'abc-123',
  slug: 'power-outage-cdmx',
  title: 'Power outage in CDMX?',
  description: null,
  category_id: 'cat-1',
  category: { id: 'cat-1', name: 'Urban', slug: 'urban', color: '#94a3b8', icon_url: null, display_order: 1 },
  status: 'active',
  trigger_type: 'manual',
  trigger_condition: {},
  trigger_deadline: '2026-06-30T23:59:59Z',
  location: { lat: 19.4, lng: -99.1, city: 'CDMX', country: 'MX' },
  icon_url: null,
  total_volume_usd: 50000,
  total_volume_mxn: 0,
  is_featured: false,
  settled_outcome: null,
  created_by: 'admin',
  created_at: '2026-01-01T00:00:00Z',
  settled_at: null,
  coverage_tiers: [
    { id: 'tier-basic', contract_id: 'abc-123', name: 'basic', premium_usd: 12, payout_usd: 500, premium_mxn: 204, payout_mxn: 8500, max_capacity_usd: 100000, current_capacity_usd: 0, base_probability: 0.1, last_priced_at: null, pricing_inputs: null },
    { id: 'tier-premium', contract_id: 'abc-123', name: 'premium', premium_usd: 38, payout_usd: 2000, premium_mxn: 646, payout_mxn: 34000, max_capacity_usd: 100000, current_capacity_usd: 0, base_probability: 0.1, last_priced_at: null, pricing_inputs: null },
  ],
}

// Recurring contract (weather) — same shape but different trigger_type and slug
const recurringContract: ContractWithTiers = {
  ...mockContract,
  id: 'wx-456',
  slug: 'heat-wave-cdmx',
  title: 'Heat wave in CDMX?',
  trigger_type: 'weather',
}

describe('PurchasePanel', () => {
  it('shows AuthGate when userId is null', () => {
    render(<PurchasePanel contract={mockContract} userId={null} open initialMode="buy" onClose={vi.fn()} />)
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument()
  })

  it('shows tier selector when user is present', () => {
    render(<PurchasePanel contract={mockContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    expect(screen.getByText(/select tier/i)).toBeInTheDocument()
  })

  it('toggles to provide mode', async () => {
    render(<PurchasePanel contract={mockContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /provide capital/i }))
    expect(screen.getAllByText(/capacity remaining/i).length).toBeGreaterThan(0)
  })

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn()
    render(<PurchasePanel contract={mockContract} userId="user-1" open initialMode="buy" onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close panel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('panel is translated off-screen when open is false', () => {
    render(<PurchasePanel contract={mockContract} userId="user-1" open={false} initialMode="buy" onClose={vi.fn()} />)
    expect(screen.getByRole('dialog').className).toContain('translate-x-full')
  })

  // Period selector — recurring contract
  it('shows period pills for weather contract in buy mode', () => {
    render(<PurchasePanel contract={recurringContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    expect(screen.getByText('1 day')).toBeInTheDocument()
    expect(screen.getByText('7 days')).toBeInTheDocument()
    expect(screen.getByText('30 days')).toBeInTheDocument()
  })

  it('does not show period pills for manual contract', () => {
    render(<PurchasePanel contract={mockContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    expect(screen.queryByText('7 days')).not.toBeInTheDocument()
  })

  it('does not show period pills in provide mode for recurring contract', async () => {
    render(<PurchasePanel contract={recurringContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /provide capital/i }))
    expect(screen.queryByText('7 days')).not.toBeInTheDocument()
  })

  it('period pills reset when switching back to buy mode', async () => {
    render(<PurchasePanel contract={recurringContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /7 days/i }))
    await userEvent.click(screen.getByRole('button', { name: /provide capital/i }))
    await userEvent.click(screen.getByRole('button', { name: /buy protection/i }))
    // After switching back, no period is selected — Continue is disabled
    const continueBtn = screen.getByRole('button', { name: /continue to payment/i })
    expect(continueBtn).toBeDisabled()
  })

  it('Continue button is disabled until period is selected for recurring contract', () => {
    render(<PurchasePanel contract={recurringContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /continue to payment/i })).toBeDisabled()
  })

  it('Continue button enables after period and tier are both selected', async () => {
    render(<PurchasePanel contract={recurringContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /7 days/i }))
    await userEvent.click(screen.getByRole('button', { name: /basic/i }))
    expect(screen.getByRole('button', { name: /continue to payment/i })).not.toBeDisabled()
  })
})
