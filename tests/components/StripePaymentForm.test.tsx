import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import StripePaymentForm from '@/components/markets/StripePaymentForm'

// Mutable holders so individual tests can swap in a live stripe/elements stub.
const stripeMocks = vi.hoisted(() => ({
  stripe: null as unknown,
  elements: null as unknown,
}))

vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn().mockResolvedValue(null) }))
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CardElement: () => <div data-testid="card-element" />,
  useStripe: () => stripeMocks.stripe,
  useElements: () => stripeMocks.elements,
}))

describe('StripePaymentForm', () => {
  beforeEach(() => {
    stripeMocks.stripe = null
    stripeMocks.elements = null
  })

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

  it('keeps the button in processing state until onSuccess resolves', async () => {
    let resolveActivation!: () => void
    const onSuccess = vi.fn(() => new Promise<void>((resolve) => { resolveActivation = resolve }))
    stripeMocks.stripe = { confirmCardPayment: vi.fn().mockResolvedValue({}) }
    stripeMocks.elements = { getElement: () => ({}) }

    render(
      <StripePaymentForm clientSecret="pi_secret" amountUsd={38} onSuccess={onSuccess} onError={vi.fn()} />
    )
    await userEvent.click(screen.getByRole('button', { name: /pay/i }))

    // Card confirmed, activation still in flight: the form must not re-enable.
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /processing/i })).toBeDisabled()

    resolveActivation()
    await waitFor(() => expect(screen.getByRole('button', { name: /pay/i })).not.toBeDisabled())
  })

  it('re-enables the button when the card is declined', async () => {
    stripeMocks.stripe = {
      confirmCardPayment: vi.fn().mockResolvedValue({ error: { message: 'Card declined' } }),
    }
    stripeMocks.elements = { getElement: () => ({}) }
    const onError = vi.fn()

    render(
      <StripePaymentForm clientSecret="pi_secret" amountUsd={38} onSuccess={vi.fn()} onError={onError} />
    )
    await userEvent.click(screen.getByRole('button', { name: /pay/i }))

    await waitFor(() => expect(onError).toHaveBeenCalledWith('Card declined'))
    expect(screen.getByRole('button', { name: /pay/i })).not.toBeDisabled()
  })
})
