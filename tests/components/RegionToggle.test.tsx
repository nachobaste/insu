import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import RegionToggle from '@/components/contracts/RegionToggle'

describe('RegionToggle', () => {
  it('renders both regions and marks the active one selected', () => {
    render(<RegionToggle region="MX" onSelect={() => {}} />)
    expect(screen.getByRole('tab', { name: /mexico/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /international/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onSelect with the clicked region', async () => {
    const onSelect = vi.fn()
    render(<RegionToggle region="MX" onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('tab', { name: /international/i }))
    expect(onSelect).toHaveBeenCalledWith('INTL')
  })
})
