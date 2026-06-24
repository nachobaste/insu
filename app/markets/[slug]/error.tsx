'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function MarketError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
    console.error('[MarketPage] render error:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-8 text-center">
      <p className="text-[13px] text-insu-muted">
        {process.env.NODE_ENV === 'development' ? error.message : 'Unable to load this market.'}
      </p>
      {process.env.NODE_ENV === 'development' && error.stack && (
        <pre className="max-w-xl overflow-auto rounded bg-white/5 p-4 text-left text-[12px] text-red-400">
          {error.stack}
        </pre>
      )}
      <button
        onClick={reset}
        className="rounded-lg bg-insu-accent px-5 py-2 text-[13px] font-bold text-bg"
      >
        Try again
      </button>
    </div>
  )
}
