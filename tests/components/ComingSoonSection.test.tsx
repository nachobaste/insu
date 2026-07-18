import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ComingSoonSection from '@/components/contracts/ComingSoonSection'
import type { ContractWithTiers } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

function makeContract(title: string): ContractWithTiers {
  return {
    id: crypto.randomUUID(),
    slug: title.toLowerCase().replace(/\s/g, '-'),
    title,
    trigger_type: 'manual',
    launch_stage: 'coming_soon',
    location: { city: 'Bogotá', country: 'CO' },
    icon_url: null,
    total_volume_usd: 0,
    is_featured: false,
    coverage_tiers: [],
    category: { id: '1', slug: 'urban', name: 'Urban', color: '#fff', display_order: 1, icon_url: null },
  } as unknown as ContractWithTiers
}

describe('ComingSoonSection', () => {
  it('renders heading and one coming-soon card per contract', () => {
    render(
      <ComingSoonSection
        contracts={[makeContract('Water shortage'), makeContract('Blackout')]}
        displayMode="USD"
      />,
    )
    expect(screen.getByRole('heading', { name: /coming soon/i })).toBeInTheDocument()
    expect(screen.getByText('Water shortage')).toBeInTheDocument()
    expect(screen.getByText('Blackout')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /notify me/i })).toHaveLength(2)
  })

  it('renders nothing when the list is empty', () => {
    const { container } = render(<ComingSoonSection contracts={[]} displayMode="USD" />)
    expect(container).toBeEmptyDOMElement()
  })
})
