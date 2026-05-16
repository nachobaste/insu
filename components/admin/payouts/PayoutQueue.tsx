'use client'

import { useState, useTransition } from 'react'
import { retryPayout } from '@/lib/actions/admin'
import { cn } from '@/lib/utils'

interface PayoutRow {
  id: string
  amount_usd: number
  status: string
  created_at: string
  transfer_id: string | null
  contractTitle: string
  userFullName: string | null
}

interface Props {
  payouts: PayoutRow[]
}

type Filter = 'all' | 'processing' | 'completed'

export function PayoutQueue({ payouts: initialPayouts }: Props) {
  const [payouts, setPayouts] = useState(initialPayouts)
  const [filter, setFilter] = useState<Filter>('all')
  const [retrying, setRetrying] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [, startTransition] = useTransition()

  const processingCount = payouts.filter((p) => p.status === 'processing').length
  const completedCount = payouts.filter((p) => p.status === 'completed').length
  const totalVolume = payouts.reduce((sum, p) => sum + p.amount_usd, 0)

  const filtered = filter === 'all' ? payouts
    : payouts.filter((p) => p.status === filter)

  function handleRetry(payoutId: string) {
    setRetrying(payoutId)
    setErrors((prev) => { const next = { ...prev }; delete next[payoutId]; return next })

    startTransition(async () => {
      try {
        await retryPayout(payoutId)
        setPayouts((prev) =>
          prev.map((p) => p.id === payoutId ? { ...p, status: 'completed' } : p),
        )
      } catch (err) {
        setErrors((prev) => ({
          ...prev,
          [payoutId]: err instanceof Error ? err.message : 'Retry failed',
        }))
      } finally {
        setRetrying(null)
      }
    })
  }

  const statCls = 'rounded-lg border p-4 text-center'

  return (
    <div>
      <h1 className="mb-5 font-display text-2xl tracking-wide text-insu-text">Payout Queue</h1>

      {/* Stats strip */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className={cn(statCls, 'border-white/[0.07]')}>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-insu-muted">Total</p>
          <p className="font-mono text-2xl text-insu-text">{payouts.length}</p>
        </div>
        <div className={cn(statCls, 'border-insu-green/30')}>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-insu-muted">Completed</p>
          <p className="font-mono text-2xl text-insu-green">{completedCount}</p>
        </div>
        <div className={cn(statCls, processingCount > 0 ? 'border-insu-accent/40' : 'border-white/[0.07]')}>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-insu-muted">Processing</p>
          <p className={cn('font-mono text-2xl', processingCount > 0 ? 'text-insu-accent' : 'text-insu-text')}>{processingCount}</p>
        </div>
        <div className={cn(statCls, 'border-white/[0.07]')}>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-insu-muted">Volume</p>
          <p className="font-mono text-2xl text-insu-text">${(totalVolume / 1000).toFixed(0)}k</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="mb-4 flex gap-2">
        {(['all', 'processing', 'completed'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-md px-3 py-1.5 text-[12px] font-medium capitalize transition-colors',
              filter === f
                ? 'bg-white/[0.07] text-insu-text'
                : 'text-insu-muted hover:text-insu-dim',
            )}
          >
            {f === 'processing' ? `Processing (${processingCount})` : f === 'all' ? 'All' : 'Completed'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-white/[0.07] overflow-hidden">
        <div className="grid grid-cols-[1fr_130px_80px_90px_90px_80px] gap-3 border-b border-white/[0.07] bg-white/[0.02] px-4 py-2.5 text-[10px] uppercase tracking-wider text-insu-muted">
          <span>User / Contract</span><span>Transfer ID</span><span>Amount</span><span>Created</span><span>Status</span><span>Action</span>
        </div>

        {filtered.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-insu-muted">No payouts found.</p>
        )}

        {filtered.map((payout) => (
          <div key={payout.id}>
            <div
              className={cn(
                'grid grid-cols-[1fr_130px_80px_90px_90px_80px] gap-3 border-b border-white/[0.04] px-4 py-3 text-sm last:border-0 items-center',
                payout.status === 'processing' && 'border-insu-accent/20',
                payout.status === 'completed' && 'opacity-65',
              )}
            >
              <div>
                <p className="font-medium text-insu-text">{payout.userFullName ?? 'Unknown'}</p>
                <p className="text-[11px] text-insu-muted">{payout.contractTitle}</p>
              </div>
              <span className="truncate font-mono text-[11px] text-insu-muted">
                {payout.transfer_id ?? '—'}
              </span>
              <span className="font-mono text-insu-green">${payout.amount_usd.toLocaleString()}</span>
              <span className="text-insu-muted">{new Date(payout.created_at).toLocaleDateString()}</span>
              <span className={cn(
                'rounded px-2 py-0.5 text-[11px] font-medium w-fit',
                payout.status === 'completed' ? 'bg-insu-green/10 text-insu-green' : 'bg-insu-accent/10 text-insu-accent',
              )}>
                {payout.status}
              </span>
              <div>
                {payout.status === 'processing' && (
                  <button
                    onClick={() => handleRetry(payout.id)}
                    disabled={retrying === payout.id}
                    className="rounded-md bg-insu-accent px-3 py-1 text-[12px] font-bold text-bg disabled:opacity-50 hover:bg-[#f7b84a]"
                  >
                    {retrying === payout.id ? '…' : 'Retry'}
                  </button>
                )}
              </div>
            </div>
            {errors[payout.id] && (
              <div className="border-b border-white/[0.04] bg-red-500/5 px-4 py-2 text-[12px] text-red-400">
                {errors[payout.id]}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
