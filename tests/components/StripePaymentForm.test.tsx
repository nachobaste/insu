import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import StripePaymentForm from '@/components/markets/StripePaymentForm'

vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn().mockResolvedValue(null) }))
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CardElement: () => <div data-testid="card-element" />,
  useStripe: () => null,
  useElements: () => null,
}))

describe('StripePaymentForm', () => {
  it('renders the pay button with formatted amount', () => {
    render(
      <StripePaymentForm clientSecret="pi_secret" amountUsd={38} onSuccess={vi.fn()} onError={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: /pay \$38/i })).toBeInTheDocument()
  })

  it('disables pay button when stripe is not loaded', () => {
    render(
      <StripePaymentForm clientSecret="pi_secret" amountUsd={38} onSuccess={vi.fn()} onError={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: /pay/i })).toBeDisabled()
  })

  it('renders the card element', () => {
    render(
      <StripePaymentForm clientSecret="pi_secret" amountUsd={38} onSuccess={vi.fn()} onError={vi.fn()} />
    )
    expect(screen.getByTestId('card-element')).toBeInTheDocument()
  })
})
