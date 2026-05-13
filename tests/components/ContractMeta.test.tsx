import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ContractMeta from '@/components/markets/ContractMeta'
import type { ContractWithTiers } from '@/lib/types'

const mockContract: ContractWithTiers = {
  id: 'abc-123',
  slug: 'power-outage-cdmx',
  title: 'Power outage in CDMX?',
  description: null,
  category_id: 'cat-1',
  category: { id: 'cat-1', name: 'Urban', slug: 'urban', color: '#94a3b8', icon_url: null, display_order: 1 },
  status: 'active',
  trigger_type: 'manual',
  trigger_condition: { description: 'Power outage > 2 hours' },
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
  coverage_tiers: [],
}

describe('ContractMeta', () => {
  it('renders trigger type label', () => {
    render(<ContractMeta contract={mockContract} />)
    expect(screen.getByText('Manual')).toBeInTheDocument()
  })

  it('renders trigger condition description', () => {
    render(<ContractMeta contract={mockContract} />)
    expect(screen.getByText('Power outage > 2 hours')).toBeInTheDocument()
  })

  it('renders location city and country', () => {
    render(<ContractMeta contract={mockContract} />)
    expect(screen.getByText('CDMX, MX')).toBeInTheDocument()
  })

  it('renders formatted volume', () => {
    render(<ContractMeta contract={mockContract} />)
    expect(screen.getByText('$50k')).toBeInTheDocument()
  })
})
