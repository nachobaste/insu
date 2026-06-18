'use client'

import { useEffect } from 'react'
import Link from 'next/link'

// Route-segment error boundary for the dashboard. Catches failures from the
// server fetch (getDashboardData) or client rendering and offers a retry.
// Note: this is a Client Component, so it cannot import the async server
// `Header`; it renders a minimal self-contained shell instead.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Dashboard error:', error)
  }, [error])

  return (
    <div className="mx-auto max-w-2xl px-6 py-20 text-center">
      <p className="font-display text-[13px] uppercase tracking-[2px] text-insu-accent">
        Something went wrong
      </p>
      <h1 className="mt-3 font-body text-lg font-bold text-insu-text">
        We couldn&apos;t load your portfolio
      </h1>
      <p className="mx-auto mt-2 max-w-sm font-body text-[13px] text-insu-muted">
        This is usually temporary. Try again, and if it keeps happening please
        let us know.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-full bg-insu-accent px-5 py-2 font-body text-[13px] font-bold text-bg transition-opacity hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full border border-white/[0.12] px-5 py-2 font-body text-[13px] text-insu-dim transition-colors hover:text-insu-text"
        >
          Back to marketplace
        </Link>
      </div>
    </div>
  )
}
