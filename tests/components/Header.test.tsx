import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Header from '@/components/layout/Header'

describe('Header', () => {
  it('renders the INSU wordmark', () => {
    render(<Header />)
    expect(screen.getByText('INSU')).toBeInTheDocument()
  })

  it('renders Log In and Sign Up buttons', () => {
    render(<Header />)
    expect(screen.getByRole('link', { name: /log in/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign up/i })).toBeInTheDocument()
  })

  it('renders the search input', () => {
    render(<Header />)
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('renders the How it works link', () => {
    render(<Header />)
    expect(screen.getByRole('link', { name: /how it works/i })).toBeInTheDocument()
  })
})
