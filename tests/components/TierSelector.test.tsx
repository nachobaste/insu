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
    expect(screen.getByText('Premium')).toBeInTheDocument()
  })

  it('shows selected indicator on selected tier', () => {
    render(<TierSelector tiers={tiers} selectedTierId="tier-basic" onSelect={vi.fn()} />)
    expect(screen.getByText('✓ Selected')).toBeInTheDocument()
  })

  it('calls onSelect with tier id when clicked', async () => {
    const onSelect = vi.fn()
    render(<TierSelector tiers={tiers} selectedTierId={null} onSelect={onSelect} />)
    await userEvent.click(screen.getAllByRole('button')[1]) // second button = Premium
    expect(onSelect).toHaveBeenCalledWith('tier-premium')
  })

  it('shows capacity remaining in provide mode', () => {
    render(<TierSelector tiers={tiers} selectedTierId={null} onSelect={vi.fn()} mode="provide" />)
    expect(screen.getAllByText(/capacity remaining/i).length).toBeGreaterThan(0)
  })

  it('disables full tier', () => {
    const fullTiers = [{ ...tiers[0], current_capacity_usd: 100000 }]
    render(<TierSelector tiers={fullTiers} selectedTierId={null} onSelect={vi.fn()} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
