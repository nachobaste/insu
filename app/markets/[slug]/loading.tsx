export default function Loading() {
  return (
    <main className="mx-auto max-w-[1320px] px-8 py-10">
      <div className="grid grid-cols-[1fr_360px] gap-8">
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
