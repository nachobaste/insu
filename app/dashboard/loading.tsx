import Header from '@/components/layout/Header'

// Shown via Suspense while the dashboard server component fetches positions.
export default function DashboardLoading() {
  return (
    <>
      <Header />
      <div className="mx-auto max-w-2xl px-6 py-8" aria-busy="true" aria-label="Loading your portfolio">
        <div className="mb-6">
          <div className="h-3 w-24 animate-pulse rounded bg-white/[0.08]" />
          <div className="mt-2 h-2.5 w-44 animate-pulse rounded bg-white/[0.05]" />
        </div>

        {/* Stats strip */}
        <div className="mb-6 grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-white/[0.07] bg-bg-card p-4">
              <div className="mx-auto h-6 w-12 animate-pulse rounded bg-white/[0.08]" />
              <div className="mx-auto mt-2 h-2.5 w-16 animate-pulse rounded bg-white/[0.05]" />
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-2 border-b border-white/[0.07] pb-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-6 w-20 animate-pulse rounded-full bg-white/[0.06]" />
          ))}
        </div>

        {/* Cards */}
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-card border border-white/[0.07] bg-bg-card p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-white/[0.08]" />
                  <div className="mt-2 h-2.5 w-1/3 animate-pulse rounded bg-white/[0.05]" />
                </div>
                <div className="h-4 w-14 animate-pulse rounded-full bg-white/[0.06]" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="space-y-1.5">
                    <div className="mx-auto h-2 w-10 animate-pulse rounded bg-white/[0.05]" />
                    <div className="mx-auto h-3 w-12 animate-pulse rounded bg-white/[0.08]" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
