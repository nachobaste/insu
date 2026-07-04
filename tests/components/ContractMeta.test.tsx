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
  is_recurring: false,
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

  it('formats a metric/operator/threshold condition instead of dumping JSON', () => {
    const c = {
      ...mockContract,
      trigger_type: 'weather',
      trigger_condition: { metric: 'temp_c', operator: 'gt', threshold: 40 },
    } as ContractWithTiers
    render(<ContractMeta contract={c} />)
    expect(
      screen.getByText((t) => t.includes('Temperature') && t.includes('40')),
    ).toBeInTheDocument()
    // never expose raw JSON / internal keys
    expect(screen.queryByText(/[{}]|"metric"|operator/)).not.toBeInTheDocument()
  })

  it('formats a typed event-cancellation condition', () => {
    const c = {
      ...mockContract,
      trigger_type: 'manual',
      trigger_condition: { type: 'event_cancellation', event_name: 'Bad Bunny Concert' },
    } as ContractWithTiers
    render(<ContractMeta contract={c} />)
    expect(screen.getByText('Bad Bunny Concert cancelled')).toBeInTheDocument()
  })

  it('omits a missing country instead of showing "undefined"', () => {
    const c = {
      ...mockContract,
      location: { lat: 0, lng: 0, city: 'Manaus' } as ContractWithTiers['location'],
    }
    render(<ContractMeta contract={c} />)
    expect(screen.getByText('Manaus')).toBeInTheDocument()
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
  })

  it('renders "Air quality" label and IMECA condition for air_quality trigger type', () => {
    const c = {
      ...mockContract,
      trigger_type: 'air_quality',
      trigger_condition: { metric: 'aqi_imeca', operator: 'gte', threshold: 150 },
    } as ContractWithTiers
    render(<ContractMeta contract={c} />)
    expect(screen.getByText('Air quality')).toBeInTheDocument()
    expect(
      screen.getByText((t) => t.includes('IMECA air quality index') && t.includes('150')),
    ).toBeInTheDocument()
  })
})
