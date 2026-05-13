'use client'

interface Props {
  clientSecret: string
  amountUsd: number
  onSuccess: () => void
  onError: (message: string) => void
}

// TODO: implement full Stripe Elements form in Task 9
export default function StripePaymentForm({ clientSecret, amountUsd, onSuccess, onError }: Props) {
  void clientSecret
  void amountUsd
  void onSuccess
  void onError
  return <div data-testid="stripe-form" />
}
