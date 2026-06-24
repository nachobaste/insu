import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import TierSelector from '@/components/markets/TierSelector'
import type { CoverageTier } from '@/lib/types'

const tiers: CoverageTier[] = [
  {
    id: 'tier-basic',
    contract_id: 'c1',
    name: 'basic',
    premium_usd: 12,
    max_payouts: 1,
    payout_usd: 500,
    premium_mxn: 204,
    payout_mxn: 8500,
    max_capacity_usd: 100000,
    current_capacity_usd: 0,
    base_probability: 0.1,
    last_priced_at: null,
    pricing_inputs: null,
  },
  {
    id: 'tier-premium',
    contract_id: 'c1',
    name: 'premium',
    premium_usd: 38,
    max_payouts: 3,
    payout_usd: 2000,
    premium_mxn: 646,
    payout_mxn: 34000,
    max_capacity_usd: 100000,
    current_capacity_usd: 0,
    base_probability: 0.1,
    last_priced_at: null,
    pricing_inputs: null,
  },
]

describe('TierSelector', () => {
  it('renders both tier names', () => {
    render(<TierSelector tiers={tiers} selectedTierId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Basic')).toBeInTheDocument()
    expect(screen.getByText('Pro')).toBeInTheDocument()
  })

  it('shows selected indicator on selected tier', () => {
    render(<TierSelector tiers={tiers} selectedTierId="tier-basic" onSelect={vi.fn()} />)
    expect(screen.getByText('✓ Selected')).toBeInTheDocument()
  })

  it('calls onSelect with tier id when clicked', async () => {
    const onSelect = vi.fn()
    render(<TierSelector tiers={tiers} selectedTierId={null} onSelect={onSelect} mode="provide" />)
    await userEvent.click(screen.getByText(/pro/i))
    expect(onSelect).toHaveBeenCalledWith('tier-premium')
  })

  it('shows capacity remaining in provide mode', () => {
    render(<TierSelector tiers={tiers} selectedTierId={null} onSelect={vi.fn()} mode="provide" />)
    expect(screen.getAllByText(/capacity remaining/i).length).toBeGreaterThan(0)
  })

  it('disables full tier', () => {
    const fullTiers = [{ ...tiers[0], id: 'tier-full', current_capacity_usd: 100, payout_usd: 500 }]
    render(<TierSelector tiers={fullTiers} selectedTierId={null} onSelect={vi.fn()} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('shows premium_usd sticker when no price map provided', () => {
    render(<TierSelector tiers={tiers} selectedTierId={null} onSelect={() => {}} />)
    expect(screen.getByText('$12 USD')).toBeInTheDocument()
  })
  it('shows the live price from priceByTier when provided', () => {
    render(<TierSelector tiers={tiers} selectedTierId={null} onSelect={() => {}} priceByTier={{ 'tier-basic': 3.45 }} />)
    expect(screen.getByText('$3 USD')).toBeInTheDocument()
  })

  it('describes the payout count per tier (Basic one-time, Pro up to 3)', () => {
    render(<TierSelector tiers={tiers} selectedTierId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Pays out once')).toBeInTheDocument()
    expect(screen.getByText('Pays out up to 3 times')).toBeInTheDocument()
  })

  it('labels the payout "per event" only on multi-payout tiers', () => {
    render(<TierSelector tiers={tiers} selectedTierId={null} onSelect={vi.fn()} />)
    // Pro pays out up to 3 times, so each payout is per-event.
    expect(screen.getByText('payout/event')).toBeInTheDocument()
    // Basic pays once, so it stays a plain "payout".
    expect(screen.getByText('payout')).toBeInTheDocument()
  })

  // Funded tiers so isFull (no-capital) doesn't mask the lock behavior under test.
  const fundedTiers = tiers.map((t) => ({ ...t, current_capacity_usd: t.payout_usd }))

  it('locks a tier and shows the reason when lockedReasonByTier is provided', () => {
    render(
      <TierSelector
        tiers={fundedTiers}
        selectedTierId={null}
        onSelect={vi.fn()}
        lockedReasonByTier={{ 'tier-premium': 'Needs 7+ days' }}
      />,
    )
    expect(screen.getByText('Needs 7+ days')).toBeInTheDocument()
    expect(screen.getByText('Pro').closest('button')).toBeDisabled()
    expect(screen.getByText('Basic').closest('button')).not.toBeDisabled()
  })

  it('does not select a locked tier when clicked', async () => {
    const onSelect = vi.fn()
    render(
      <TierSelector
        tiers={fundedTiers}
        selectedTierId={null}
        onSelect={onSelect}
        lockedReasonByTier={{ 'tier-premium': 'Needs 7+ days' }}
      />,
    )
    await userEvent.click(screen.getByText('Pro'))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
