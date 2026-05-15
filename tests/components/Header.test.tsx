import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Header from '@/components/layout/Header'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  })),
}))

describe('Header', () => {
  it('renders the INSU wordmark', async () => {
    render(await Header())
    expect(screen.getByText('INSU')).toBeInTheDocument()
  })

  it('renders Log In and Sign Up buttons when logged out', async () => {
    render(await Header())
    expect(screen.getByRole('link', { name: /log in/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign up/i })).toBeInTheDocument()
  })

  it('renders Portfolio link when logged in', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
    } as never)
    render(await Header())
    expect(screen.getByRole('link', { name: /portfolio/i })).toBeInTheDocument()
  })

  it('renders the search input', async () => {
    render(await Header())
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('renders the How it works link', async () => {
    render(await Header())
    expect(screen.getByRole('link', { name: /how it works/i })).toBeInTheDocument()
  })
})
