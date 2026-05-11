import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ContractCard from '@/components/contracts/ContractCard'
import type { ContractWithTiers } from '@/lib/types'

const mockContract: ContractWithTiers = {
  id: 'abc-123',
  slug: 'power-outage-cdmx',
  title: 'Power outage in CDMX of more than 2 hours?',
  description: null,
  category_id: '11111111-0000-0000-0000-000000000001',
  category: {
    id: '11111111-0000-0000-0000-000000000001',
    name: 'Urban',
    slug: 'urban',
    color: '#94a3b8',
    icon_url: null,
    display_order: 1,
  },
  status: 'active',
  trigger_type: 'manual',
  trigger_condition: {},
  trigger_deadline: '2026-01-31T23:59:59Z',
  location: { lat: 19.4, lng: -99.1, city: 'CDMX', country: 'MX' },
  icon_url: null,
  total_volume_usd: 9_000_000,
  total_volume_mxn: 0,
  is_featured: false,
  settled_outcome: null,
  created_by: 'admin',
  created_at: '2026-01-01T00:00:00Z',
  settled_at: null,
  coverage_tiers: [
    {
      id: 'tier-1',
      contract_id: 'abc-123',
      name: 'basic',
      premium_usd: 100,
      payout_usd: 500,
      premium_mxn: 1700,
      payout_mxn: 8500,
      max_capacity_usd: 100000,
      current_capacity_usd: 45000,
      base_probability: 0.18,
      last_priced_at: null,
      pricing_inputs: null,
    },
    {
      id: 'tier-2',
      contract_id: 'abc-123',
      name: 'premium',
      premium_usd: 600,
      payout_usd: 1700,
      premium_mxn: 10200,
      payout_mxn: 28900,
      max_capacity_usd: 100000,
      current_capacity_usd: 20000,
      base_probability: 0.18,
      last_priced_at: null,
      pricing_inputs: null,
    },
  ],
}

describe('ContractCard', () => {
  it('renders the contract title', () => {
    render(<ContractCard contract={mockContract} currency="USD" />)
    expect(
      screen.getByText('Power outage in CDMX of more than 2 hours?')
    ).toBeInTheDocument()
  })

  it('renders basic tier premium and payout', () => {
    render(<ContractCard contract={mockContract} currency="USD" />)
    expect(screen.getByText('$100')).toBeInTheDocument()
    expect(screen.getByText('$500')).toBeInTheDocument()
  })

  it('renders premium tier premium and payout', () => {
    render(<ContractCard contract={mockContract} currency="USD" />)
    expect(screen.getByText('$600')).toBeInTheDocument()
    expect(screen.getByText('$1,700')).toBeInTheDocument()
  })

  it('renders volume', () => {
    render(<ContractCard contract={mockContract} currency="USD" />)
    expect(screen.getByText('$9.0m Vol.')).toBeInTheDocument()
  })

  it('renders a Buy now button', () => {
    render(<ContractCard contract={mockContract} currency="USD" />)
    expect(screen.getByRole('button', { name: /buy now/i })).toBeInTheDocument()
  })
})
