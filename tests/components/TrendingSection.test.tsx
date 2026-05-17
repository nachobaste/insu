import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import TrendingSection from '@/components/contracts/TrendingSection'
import type { ContractWithTiers } from '@/lib/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

function makeContract(overrides: Partial<ContractWithTiers>): ContractWithTiers {
  return {
    id: 'id-1',
    slug: 'test-slug',
    title: 'Test contract title',
    description: null,
    category_id: 'cat-1',
    category: { id: 'cat-1', name: 'Urban', slug: 'urban', color: '#94a3b8', icon_url: null, display_order: 1 },
    status: 'active',
    trigger_type: 'manual',
    trigger_condition: {},
    trigger_deadline: '2027-01-01T00:00:00Z',
    location: { lat: 0, lng: 0, city: 'CDMX', country: 'MX' },
    icon_url: null,
    total_volume_usd: 1_000_000,
    total_volume_mxn: 0,
    is_featured: false,
    settled_outcome: null,
    created_by: 'admin',
    created_at: new Date().toISOString(),
    settled_at: null,
    coverage_tiers: [
      {
        id: 'tier-1',
        contract_id: 'id-1',
        name: 'basic',
        premium_usd: 100,
        payout_usd: 500,
        premium_mxn: 1700,
        payout_mxn: 8500,
        max_capacity_usd: 100000,
        current_capacity_usd: 50000,
        base_probability: 0.18,
        last_priced_at: null,
        pricing_inputs: null,
      },
    ],
    ...overrides,
  }
}

describe('TrendingSection', () => {
  it('renders the section heading', () => {
    render(<TrendingSection contracts={[makeContract({})]} currency="USD" />)
    expect(screen.getByText('Trending Now')).toBeInTheDocument()
  })

  it('renders a card for each contract', () => {
    const contracts = [
      makeContract({ id: '1', title: 'Contract Alpha' }),
      makeContract({ id: '2', title: 'Contract Beta' }),
    ]
    render(<TrendingSection contracts={contracts} currency="USD" />)
    expect(screen.getByText('Contract Alpha')).toBeInTheDocument()
    expect(screen.getByText('Contract Beta')).toBeInTheDocument()
  })

  it('renders the cheapest tier premium as the "from" price in USD', () => {
    render(<TrendingSection contracts={[makeContract({})]} currency="USD" />)
    expect(screen.getByText('$100')).toBeInTheDocument()
  })

  it('renders nothing when contracts array is empty', () => {
    const { container } = render(<TrendingSection contracts={[]} currency="USD" />)
    expect(container.firstChild).toBeNull()
  })
})
