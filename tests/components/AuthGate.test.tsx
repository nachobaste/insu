import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AuthGate from '@/components/markets/AuthGate'

describe('AuthGate', () => {
  it('renders sign-in message', () => {
    render(<AuthGate next="/markets/power-outage-cdmx" />)
    expect(screen.getByText(/sign in to buy/i)).toBeInTheDocument()
  })

  it('renders sign-in link with encoded next param', () => {
    render(<AuthGate next="/markets/power-outage-cdmx" />)
    const link = screen.getByRole('link', { name: /sign in/i })
    expect(link).toHaveAttribute(
      'href',
      '/auth/login?next=%2Fmarkets%2Fpower-outage-cdmx'
    )
  })
})
