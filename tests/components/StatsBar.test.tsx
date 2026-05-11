import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import StatsBar from '@/components/contracts/StatsBar'

const mockStats = {
  totalVolumeUsd: 24_300_000,
  activeContracts: 142,
  protectionsSold: 8204,
  avgPayoutMinutes: 4.2,
}

describe('StatsBar', () => {
  it('renders volume formatted as millions', () => {
    render(<StatsBar stats={mockStats} />)
    expect(screen.getByText('$24.3m')).toBeInTheDocument()
  })

  it('renders active contracts count', () => {
    render(<StatsBar stats={mockStats} />)
    expect(screen.getByText('142')).toBeInTheDocument()
  })

  it('renders protections sold', () => {
    render(<StatsBar stats={mockStats} />)
    expect(screen.getByText('8,204')).toBeInTheDocument()
  })

  it('renders 100% auto-settled label', () => {
    render(<StatsBar stats={mockStats} />)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })
})
