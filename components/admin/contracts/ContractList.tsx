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
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl tracking-wide text-insu-text">Contracts</h1>
        <Link
          href="/admin/contracts/new"
          className="rounded-md bg-insu-accent px-4 py-2 text-sm font-bold text-bg hover:bg-[#f7b84a]"
        >
          + New Contract
        </Link>
      </div>

      <div className="rounded-lg border border-white/[0.07] overflow-hidden">
        <div className="grid grid-cols-[1fr_100px_80px_90px_60px] gap-3 border-b border-white/[0.07] bg-white/[0.02] px-4 py-2.5 text-[11px] uppercase tracking-wider text-insu-muted">
          <span>Title</span><span>Category</span><span>Type</span><span>Status</span><span>Action</span>
        </div>

        {contracts.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-insu-muted">No contracts yet.</p>
        )}

        {contracts.map((c) => (
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
              Edit
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
