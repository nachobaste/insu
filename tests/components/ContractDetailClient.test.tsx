import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ContractDetailClient from '@/components/markets/ContractDetailClient'
import type { ContractDetailData } from '@/lib/types'

// Mock heavy children so the test isolates the slot wiring.
vi.mock('@/components/markets/PriceChart', () => ({ default: () => <div data-testid="price-chart" /> }))
vi.mock('@/components/markets/OracleConditions', () => ({ default: () => <div data-testid="oracle" /> }))
vi.mock('@/components/markets/ContractMeta', () => ({ default: () => <div data-testid="meta" /> }))
vi.mock('@/components/markets/PurchasePanel', () => ({ default: () => <div data-testid="panel" /> }))
vi.mock('@/components/markets/TierSelector', () => ({ default: () => <div data-testid="tiers" /> }))

const contract = {
  id: 'c1',
  slug: 'reforma-am',
  title: 'Reforma → Alameda',
  description: 'desc',
  category: { id: 'cat', slug: 'urban', name: 'Urban' },
  trigger_type: 'urban',
  trigger_condition: {},
  coverage_tiers: [],
  pricing_history: [],
  location: { city: 'Mexico City', country: 'MX', lat: 0, lng: 0 },
} as unknown as ContractDetailData

describe('ContractDetailClient slots', () => {
  it('renders periodToggle and evidence when provided', () => {
    render(
      <ContractDetailClient
        contract={contract}
        userId={null}
        latestReading={null}
        periodToggle={<div data-testid="toggle" />}
        evidence={<div data-testid="evidence" />}
      />,
    )
    expect(screen.getByTestId('toggle')).toBeInTheDocument()
    expect(screen.getByTestId('evidence')).toBeInTheDocument()
  })

  it('omits the slots when not provided', () => {
    render(<ContractDetailClient contract={contract} userId={null} latestReading={null} />)
    expect(screen.queryByTestId('toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('evidence')).not.toBeInTheDocument()
  })
})
