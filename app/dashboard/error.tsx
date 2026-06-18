'use client'

import { useEffect } from 'react'
import Header from '@/components/layout/Header'

// Route-segment error boundary for the dashboard. Catches failures from the
// server fetch (getDashboardData) or client rendering and offers a retry.
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
    <>
      <Header />
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
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
        <button
          onClick={reset}
          className="mt-6 rounded-full bg-insu-accent px-5 py-2 font-body text-[13px] font-bold text-bg transition-opacity hover:opacity-90"
        >
          Try again
        </button>
      </div>
    </>
  )
}
