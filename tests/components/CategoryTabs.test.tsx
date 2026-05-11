import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import CategoryTabs from '@/components/layout/CategoryTabs'
import type { Category } from '@/lib/types'

const mockCategories: Category[] = [
  { id: '1', name: 'Urban', slug: 'urban', color: '#94a3b8', icon_url: null, display_order: 1 },
  { id: '2', name: 'Nature', slug: 'nature', color: '#34d399', icon_url: null, display_order: 2 },
]

describe('CategoryTabs', () => {
  it('renders all category names', () => {
    render(<CategoryTabs categories={mockCategories} activeSlug="urban" onSelect={vi.fn()} />)
    expect(screen.getByText('Urban')).toBeInTheDocument()
    expect(screen.getByText('Nature')).toBeInTheDocument()
  })

  it('calls onSelect with slug when tab is clicked', async () => {
    const onSelect = vi.fn()
    render(<CategoryTabs categories={mockCategories} activeSlug="urban" onSelect={onSelect} />)
    await userEvent.click(screen.getByText('Nature'))
    expect(onSelect).toHaveBeenCalledWith('nature')
  })

  it('marks the active tab with aria-selected', () => {
    render(<CategoryTabs categories={mockCategories} activeSlug="nature" onSelect={vi.fn()} />)
    const tab = screen.getByRole('tab', { name: /nature/i })
    expect(tab).toHaveAttribute('aria-selected', 'true')
  })
})
