'use client'

import { useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

const CARD_STYLE = {
  style: {
    base: {
      color: '#e8edf5',
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: '14px',
      '::placeholder': { color: '#5a6580' },
    },
    invalid: { color: '#f87171' },
  },
}

interface FormProps {
  clientSecret: string
  amountUsd: number
  onSuccess: () => void
  onError: (msg: string) => void
}

function CardPaymentForm({ clientSecret, amountUsd, onSuccess, onError }: FormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setLoading(true)

    const card = elements.getElement(CardElement)
    if (!card) { setLoading(false); return }

    const { error } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card },
    })

    setLoading(false)
    if (error) {
      onError(error.message ?? 'Payment failed')
    } else {
      onSuccess()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wider text-insu-muted">
          Card details
        </label>
        <div className="rounded-lg border border-white/[0.07] bg-bg px-4 py-3">
          <CardElement options={CARD_STYLE} />
        </div>
      </div>
      <button
        type="submit"
        disabled={!stripe || loading}
        className="w-full rounded-lg bg-insu-accent py-3 text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a] disabled:opacity-40"
      >
        {loading ? 'Processing…' : `Pay $${amountUsd.toLocaleString()} USD`}
      </button>
    </form>
  )
}

interface Props {
  clientSecret: string
  amountUsd: number
  onSuccess: () => void
  onError: (msg: string) => void
}

export default function StripePaymentForm(props: Props) {
  return (
    <Elements stripe={stripePromise}>
      <CardPaymentForm {...props} />
    </Elements>
  )
}
