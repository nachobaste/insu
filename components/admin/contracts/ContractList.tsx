import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { ContractWithTiers } from '@/lib/types'

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-insu-green/10 text-insu-green',
  pending: 'bg-insu-accent/10 text-insu-accent',
  settled: 'bg-white/5 text-insu-dim',
  cancelled: 'bg-white/5 text-insu-dim',
}

export function ContractList({ contracts }: { contracts: ContractWithTiers[] }) {
  const pending = contracts.filter((c) => c.status === 'pending')
  const rest = contracts.filter((c) => c.status !== 'pending')

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl tracking-wide text-insu-text">Contracts</h1>
          {pending.length > 0 && (
            <span className="rounded-full bg-insu-accent/15 px-2.5 py-0.5 text-[12px] font-semibold text-insu-accent">
              {pending.length} pending review
            </span>
          )}
        </div>
        <Link
          href="/admin/contracts/new"
          className="rounded-md bg-insu-accent px-4 py-2 text-sm font-bold text-bg hover:bg-[#f7b84a]"
        >
          + New Contract
        </Link>
      </div>

      {/* Pending submissions section */}
      {pending.length > 0 && (
        <div className="mb-6 rounded-lg border border-insu-accent/20 bg-insu-accent/[0.03] p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-insu-accent">
            User submissions — awaiting review
          </p>
          <div className="space-y-2">
            {pending.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-md border border-white/[0.06] bg-bg-card px-4 py-3"
              >
                <div>
                  <p className="text-[14px] font-medium text-insu-text">{c.title}</p>
                  <p className="mt-0.5 text-[11px] text-insu-muted">
                    {c.category?.name} · {c.trigger_type} · submitted {new Date(c.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Link
                  href={`/admin/contracts/${c.id}`}
                  className="rounded-md bg-insu-accent px-3 py-1.5 text-[12px] font-bold text-bg hover:bg-[#f7b84a]"
                >
                  Review →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All contracts table */}
      <div className="overflow-hidden rounded-lg border border-white/[0.07]">
        <div className="grid grid-cols-[1fr_100px_80px_90px_60px] gap-3 border-b border-white/[0.07] bg-white/[0.02] px-4 py-2.5 text-[11px] uppercase tracking-wider text-insu-muted">
          <span>Title</span><span>Category</span><span>Type</span><span>Status</span><span>Action</span>
        </div>

        {contracts.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-insu-muted">No contracts yet.</p>
        )}

        {[...pending, ...rest].map((c) => (
          <div
            key={c.id}
            className={cn(
              'grid grid-cols-[1fr_100px_80px_90px_60px] gap-3 border-b border-white/[0.04] px-4 py-3 text-sm last:border-0',
              (c.status === 'settled' || c.status === 'cancelled') && 'opacity-60',
            )}
          >
            <div>
              <p className="font-medium text-insu-text">{c.title}</p>
              <p className="mt-0.5 text-[11px] text-insu-muted">
                Deadline {new Date(c.trigger_deadline).toLocaleDateString()}
              </p>
            </div>
            <span className="self-center text-insu-dim capitalize">{c.category?.name ?? '—'}</span>
            <span className="self-center text-insu-dim">{c.trigger_type}</span>
            <span className={cn('self-center rounded px-2 py-0.5 text-[11px] font-medium w-fit', STATUS_STYLES[c.status] ?? STATUS_STYLES.settled)}>
              {c.status}
            </span>
            <Link
              href={`/admin/contracts/${c.id}`}
              className="self-center text-[13px] text-blue-400 hover:text-blue-300"
            >
              {c.status === 'pending' ? 'Review' : 'Edit'}
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
