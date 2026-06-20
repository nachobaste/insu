export default function Loading() {
  return (
    <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <div className="h-6 w-40 animate-pulse rounded-lg bg-white/5" />
          <div className="h-8 w-3/4 animate-pulse rounded-lg bg-white/5" />
          <div className="h-[220px] animate-pulse rounded-card bg-white/5" />
          <div className="h-[160px] animate-pulse rounded-card bg-white/5" />
        </div>
        <div className="space-y-3">
          <div className="h-[96px] animate-pulse rounded-card bg-white/5" />
          <div className="h-[96px] animate-pulse rounded-card bg-white/5" />
          <div className="h-12 animate-pulse rounded-lg bg-white/5" />
          <div className="h-12 animate-pulse rounded-lg bg-white/5" />
        </div>
      </div>
    </main>
  )
}
