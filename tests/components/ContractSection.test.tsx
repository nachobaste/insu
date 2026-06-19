import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, afterEach } from 'vitest'
import ContractSection from '@/components/contracts/ContractSection'
import type { ContractWithTiers, Corridor } from '@/lib/types'

function makeCorridor(overrides: Partial<Corridor> = {}): Corridor {
  return {
    id: 'cor-1',
    slug: 'reforma-am',
    name: 'Reforma → Alameda (Mañana)',
    road: 'Paseo de la Reforma',
    origin_lat: 19.4001,
    origin_lng: -99.1892,
    dest_lat: 19.4354,
    dest_lng: -99.1452,
    window_start: '07:00:00',
    window_end: '10:00:00',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeContract(overrides: Partial<ContractWithTiers>): ContractWithTiers {
  return {
    id: 'id-1',
    slug: 'test-contract',
    title: 'Test contract',
    description: null,
    category_id: 'cat-1',
    category: { id: 'cat-1', name: 'Urban', slug: 'urban', color: '#94a3b8', icon_url: null, display_order: 1 },
    status: 'active',
    trigger_type: 'urban',
    trigger_condition: {},
    trigger_deadline: '2027-01-01T00:00:00Z',
    is_recurring: false,
    location: { lat: 0, lng: 0, city: 'Mexico City', country: 'MX' },
    icon_url: null,
    total_volume_usd: 0,
    total_volume_mxn: 0,
    is_featured: false,
    settled_outcome: null,
    created_by: 'admin',
    created_at: new Date().toISOString(),
    settled_at: null,
    coverage_tiers: [],
    corridor: null,
    ...overrides,
  }
}

describe('ContractSection road chips', () => {
  it('renders an All chip and one chip per distinct corridor road for urban contracts', () => {
    const contracts = [
      makeContract({ id: '1', corridor: makeCorridor({ road: 'Paseo de la Reforma' }) }),
      makeContract({ id: '2', corridor: makeCorridor({ road: 'Paseo de la Reforma', slug: 'reforma-pm', window_start: '17:00:00' }) }),
      makeContract({ id: '3', corridor: makeCorridor({ road: 'Circuito Bicentenario', slug: 'bicentenario-am' }) }),
    ]
    render(<ContractSection categoryName="Urban" categorySlug="urban" contracts={contracts} currency="USD" />)

    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Circuito Bicentenario' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Paseo de la Reforma' })).toBeInTheDocument()
  })

  it('filters contracts to the selected corridor road when a chip is clicked', async () => {
    const contracts = [
      makeContract({ id: '1', title: 'Reforma Morning', corridor: makeCorridor({ road: 'Paseo de la Reforma' }) }),
      makeContract({ id: '2', title: 'Reforma Evening', corridor: makeCorridor({ road: 'Paseo de la Reforma', slug: 'reforma-pm', window_start: '17:00:00' }) }),
      makeContract({ id: '3', title: 'Bicentenario Morning', corridor: makeCorridor({ road: 'Circuito Bicentenario', slug: 'bicentenario-am' }) }),
    ]
    render(<ContractSection categoryName="Urban" categorySlug="urban" contracts={contracts} currency="USD" />)

    await userEvent.click(screen.getByRole('button', { name: 'Circuito Bicentenario' }))

    expect(screen.getByText('Bicentenario Morning')).toBeInTheDocument()
    expect(screen.queryByText('Reforma Morning')).not.toBeInTheDocument()
    expect(screen.queryByText('Reforma Evening')).not.toBeInTheDocument()
  })

  it('keeps a contract with no corridor visible under All but hides it when a road chip is active', async () => {
    const contracts = [
      makeContract({ id: '1', title: 'General Traffic', corridor: null }),
      makeContract({ id: '2', title: 'Reforma Morning', corridor: makeCorridor({ road: 'Paseo de la Reforma' }) }),
      makeContract({ id: '3', title: 'Bicentenario Morning', corridor: makeCorridor({ road: 'Circuito Bicentenario', slug: 'bicentenario-am' }) }),
    ]
    render(<ContractSection categoryName="Urban" categorySlug="urban" contracts={contracts} currency="USD" />)

    expect(screen.getByText('General Traffic')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Paseo de la Reforma' }))

    expect(screen.queryByText('General Traffic')).not.toBeInTheDocument()
    expect(screen.getByText('Reforma Morning')).toBeInTheDocument()
  })

  it('renders no chip row when only one distinct corridor road is present', () => {
    const contracts = [
      makeContract({ id: '1', title: 'Reforma Morning', corridor: makeCorridor({ road: 'Paseo de la Reforma' }) }),
      makeContract({ id: '2', title: 'Reforma Evening', corridor: makeCorridor({ road: 'Paseo de la Reforma', slug: 'reforma-pm', window_start: '17:00:00' }) }),
    ]
    render(<ContractSection categoryName="Urban" categorySlug="urban" contracts={contracts} currency="USD" />)

    // A road's morning + evening protections collapse into one CorridorPairCard
    // with a period toggle, so both periods are reachable from a single card.
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /morning/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /evening/i })).toBeInTheDocument()
  })

  it('renders no chip row for non-urban categories', () => {
    const contracts = [
      makeContract({
        id: '1',
        category: { id: 'cat-2', name: 'Nature', slug: 'nature', color: '#34d399', icon_url: null, display_order: 2 },
      }),
    ]
    render(<ContractSection categoryName="Nature" categorySlug="nature" contracts={contracts} currency="USD" />)

    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument()
  })
})

describe('ContractSection recommended badge', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a recommended badge on the corridor contract matching the current commute period', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T08:00:00')) // 08:00 -> recommended period is "evening"

    const contracts = [
      makeContract({ id: '1', title: 'Reforma Morning', corridor: makeCorridor({ road: 'Paseo de la Reforma', window_start: '07:00:00' }) }),
      makeContract({ id: '2', title: 'Reforma Evening', corridor: makeCorridor({ road: 'Paseo de la Reforma', slug: 'reforma-pm', window_start: '17:00:00' }) }),
    ]
    render(<ContractSection categoryName="Urban" categorySlug="urban" contracts={contracts} currency="USD" />)

    // The merged CorridorPairCard defaults its active period to the recommended
    // one (evening at 08:00) and surfaces the badge for it.
    const card = screen.getByText('Reforma Evening').closest('article')
    expect(card).toHaveTextContent('recommended')
    expect(screen.queryByText('Reforma Morning')).not.toBeInTheDocument()
  })

  it('shows recommended instead of trending when a featured contract also matches the recommended period', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T08:00:00')) // -> "evening" recommended

    const contracts = [
      makeContract({
        id: '1',
        title: 'Reforma Evening',
        is_featured: true,
        corridor: makeCorridor({ road: 'Paseo de la Reforma', slug: 'reforma-pm', window_start: '17:00:00' }),
      }),
    ]
    render(<ContractSection categoryName="Urban" categorySlug="urban" contracts={contracts} currency="USD" />)

    const card = screen.getByText('Reforma Evening').closest('article')
    expect(card).toHaveTextContent('recommended')
    expect(card).not.toHaveTextContent('trending')
  })

  it('keeps the trending badge for a featured contract with no corridor', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T08:00:00'))

    const contracts = [
      makeContract({ id: '1', title: 'General Traffic', is_featured: true, corridor: null }),
    ]
    render(<ContractSection categoryName="Urban" categorySlug="urban" contracts={contracts} currency="USD" />)

    const card = screen.getByText('General Traffic').closest('article')
    expect(card).toHaveTextContent('trending')
  })
})
