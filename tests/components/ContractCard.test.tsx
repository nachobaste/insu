import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ContractCard from '@/components/contracts/ContractCard'
import type { ContractWithTiers } from '@/lib/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

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
  is_recurring: false,
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
      max_payouts: 1,
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
      max_payouts: 3,
      last_priced_at: null,
      pricing_inputs: null,
    },
  ],
}

describe('ContractCard', () => {
  it('renders the contract title', () => {
    render(<ContractCard contract={mockContract} displayMode="USD" />)
    expect(
      screen.getByText('Power outage in CDMX of more than 2 hours?')
    ).toBeInTheDocument()
  })

  it('renders basic tier premium and payout', () => {
    render(<ContractCard contract={mockContract} displayMode="USD" />)
    expect(screen.getByText('$100 USD')).toBeInTheDocument()
    expect(screen.getByText('$500 USD')).toBeInTheDocument()
  })

  it('renders premium tier premium and payout', () => {
    render(<ContractCard contract={mockContract} displayMode="USD" />)
    expect(screen.getByText('$600 USD')).toBeInTheDocument()
    expect(screen.getByText('$1,700 USD')).toBeInTheDocument()
  })

  it('renders volume', () => {
    render(<ContractCard contract={mockContract} displayMode="USD" />)
    expect(screen.getByText('$9.0m Vol.')).toBeInTheDocument()
  })

  it('renders a Buy now button', () => {
    render(<ContractCard contract={mockContract} displayMode="USD" />)
    expect(screen.getByRole('button', { name: /buy now/i })).toBeInTheDocument()
  })

  it('renders a recommended badge when badge="recommended"', () => {
    render(<ContractCard contract={mockContract} displayMode="USD" badge="recommended" />)
    expect(screen.getByText('recommended')).toBeInTheDocument()
  })

  it('renders the coming-soon variant: badge, no prices, Notify me CTA', () => {
    render(<ContractCard contract={mockContract} displayMode="USD" comingSoon />)
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
    expect(screen.getByText(/pricing available at launch/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /notify me/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /buy now/i })).not.toBeInTheDocument()
    // Assert tier pricing is not rendered
    expect(screen.queryByText('$100 USD')).not.toBeInTheDocument()
    expect(screen.queryByText('$500 USD')).not.toBeInTheDocument()
    expect(screen.queryByText('$600 USD')).not.toBeInTheDocument()
    expect(screen.queryByText('$1,700 USD')).not.toBeInTheDocument()
  })

  it('does not show coming-soon UI on live cards', () => {
    render(<ContractCard contract={mockContract} displayMode="USD" />)
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /buy now/i })).toBeInTheDocument()
  })

  it('renders peso prices for a Mexican contract in LOCAL mode', () => {
    render(<ContractCard contract={mockContract} displayMode="LOCAL" />)
    // MX contract, FX 17.0: 100 USD -> 1,700 MXN, 500 USD -> 8,500 MXN
    expect(screen.getByText('$1,700 MXN')).toBeInTheDocument()
    expect(screen.getByText('$8,500 MXN')).toBeInTheDocument()
  })

  it('renders quetzal prices for a Guatemalan contract in LOCAL mode', () => {
    const gtContract: ContractWithTiers = {
      ...mockContract,
      location: { ...mockContract.location, country: 'GT' },
    }
    render(<ContractCard contract={gtContract} displayMode="LOCAL" />)
    // GT contract, FX 7.75: 100 USD -> 775 Q, 500 USD -> 3,875 Q
    expect(screen.getByText('Q775 GTQ')).toBeInTheDocument()
    expect(screen.getByText('Q3,875 GTQ')).toBeInTheDocument()
  })
})
