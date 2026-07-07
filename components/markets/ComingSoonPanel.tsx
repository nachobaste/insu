'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { toggleLaunchInterest } from '@/lib/actions/launch-interest'

interface Props {
  contractId: string
  userId: string | null
  initiallyInterested: boolean
}

/** Replaces the purchase panel on coming-soon markets. */
export default function ComingSoonPanel({ contractId, userId, initiallyInterested }: Props) {
  const [interested, setInterested] = useState(initiallyInterested)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  return (
    <div className="rounded-card border border-amber-400/20 bg-amber-400/[0.04] p-5">
      <span className="rounded border border-amber-400/25 bg-amber-400/10 px-[7px] py-[3px] text-[10px] font-bold uppercase tracking-[0.1em] text-amber-300">
        Coming soon
      </span>
      <p className="mt-3 text-[14px] font-semibold text-insu-text">
        This coverage isn&apos;t live yet
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-insu-muted">
        We&apos;re still wiring up the data source and pricing for this product.
        Leave your interest and we&apos;ll notify you the moment it launches.
      </p>

      {userId ? (
        <button
          onClick={() => {
            setError(null)
            startTransition(async () => {
              try {
                setInterested(await toggleLaunchInterest(contractId))
              } catch {
                setError('Something went wrong — try again.')
              }
            })
          }}
          disabled={isPending}
          className={cn(
            'mt-4 w-full rounded-lg py-3 text-[14px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50',
            interested
              ? 'border border-insu-green/30 bg-insu-green/10 text-insu-green'
              : 'bg-insu-accent text-bg hover:bg-[#f7b84a]',
          )}
        >
          {interested ? "✓ We'll notify you" : 'Notify me at launch'}
        </button>
      ) : (
        <Link
          href="/auth/login"
          className="mt-4 block w-full rounded-lg bg-insu-accent py-3 text-center text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a]"
        >
          Sign in to get notified
        </Link>
      )}
      {error && <p className="mt-2 text-[12px] text-red-400">{error}</p>}
    </div>
  )
}
