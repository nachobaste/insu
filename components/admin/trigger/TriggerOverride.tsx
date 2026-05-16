'use client'

import { useState, useTransition } from 'react'
import { overrideContractTrigger } from '@/lib/actions/admin'
import { cn } from '@/lib/utils'
import type { Contract } from '@/lib/types'

interface ContractSummary {
  contract: Contract
  hedgerCount: number
  totalPayout: number
  oracleStatus: string
  lastValue: string
}

interface Props {
  contracts: Contract[]
  summaries: ContractSummary[]
}

export function TriggerOverride({ contracts, summaries }: Props) {
  const [contractId, setContractId] = useState('')
  const [outcome, setOutcome] = useState<boolean | null>(null)
  const [reason, setReason] = useState('')
  const [isPending, startTransition] = useTransition()
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const summary = summaries.find((s) => s.contract.id === contractId)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!contractId || outcome === null || !reason.trim()) return
    setError(null)

    startTransition(async () => {
      try {
        await overrideContractTrigger({ contractId, outcome: outcome!, reason })
        setSuccess(true)
        setContractId('')
        setOutcome(null)
        setReason('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Override failed')
      }
    })
  }

  const inputCls = 'w-full rounded-md border border-white/[0.07] bg-bg px-3 py-2 text-sm text-insu-text focus:border-insu-accent/40 focus:outline-none'
  const labelCls = 'mb-1 block text-[11px] uppercase tracking-wider text-insu-muted'

  return (
    <div className="max-w-lg">
      <h1 className="mb-1 font-display text-2xl tracking-wide text-insu-text">Trigger Override</h1>
      <p className="mb-6 text-sm text-insu-muted">Force-settle a contract, bypassing the oracle. This cannot be undone.</p>

      {success && (
        <div className="mb-4 rounded-md border border-insu-green/30 bg-insu-green/10 px-4 py-3 text-sm text-insu-green">
          Contract settled successfully. Payouts queued.
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className={labelCls}>Contract</label>
          <select
            className={inputCls + ' cursor-pointer'}
            value={contractId}
            onChange={(e) => { setContractId(e.target.value); setOutcome(null) }}
            required
          >
            <option value="">Select a contract…</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {new Date(c.trigger_deadline).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>

        {summary && (
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className={labelCls}>Active hedgers</p>
                <p className="font-mono text-insu-text">{summary.hedgerCount}</p>
              </div>
              <div>
                <p className={labelCls}>Total payout</p>
                <p className="font-mono text-insu-green">${summary.totalPayout.toLocaleString()}</p>
              </div>
              <div>
                <p className={labelCls}>Oracle</p>
                <p className="font-mono text-insu-dim">{summary.oracleStatus}</p>
              </div>
              <div>
                <p className={labelCls}>Trigger type</p>
                <p className="text-insu-dim">{summary.contract.trigger_type}</p>
              </div>
              <div className="col-span-2">
                <p className={labelCls}>Last reading</p>
                <p className="text-insu-dim">{summary.lastValue || '—'}</p>
              </div>
            </div>
          </div>
        )}

        <div>
          <label className={labelCls}>Settlement outcome</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setOutcome(true)}
              className={cn(
                'rounded-lg border p-4 text-left transition-colors',
                outcome === true
                  ? 'border-insu-green bg-insu-green/10'
                  : 'border-white/[0.07] hover:border-white/20',
              )}
            >
              <p className="mb-1 text-sm font-bold text-insu-green">⚡ TRIGGER FIRED</p>
              <p className="text-[12px] text-insu-muted">Hedgers receive payouts. Settles as outcome = true.</p>
            </button>
            <button
              type="button"
              onClick={() => setOutcome(false)}
              className={cn(
                'rounded-lg border p-4 text-left transition-colors',
                outcome === false
                  ? 'border-insu-dim bg-white/[0.04]'
                  : 'border-white/[0.07] hover:border-white/20',
              )}
            >
              <p className="mb-1 text-sm font-bold text-insu-dim">✕ NO TRIGGER</p>
              <p className="text-[12px] text-insu-muted">No payouts. Providers keep yield. outcome = false.</p>
            </button>
          </div>
        </div>

        <div>
          <label className={labelCls}>Reason (required)</label>
          <textarea
            className={inputCls}
            rows={2}
            placeholder="e.g. Oracle API outage confirmed by OWM support"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />
        </div>

        <button
          type="submit"
          disabled={isPending || outcome === null || !contractId || !reason.trim()}
          className="w-full rounded-md bg-red-500 py-2.5 text-sm font-bold tracking-wide text-white disabled:opacity-40 hover:bg-red-400"
        >
          {isPending
            ? 'Processing…'
            : outcome === null
              ? 'SELECT AN OUTCOME TO CONFIRM'
              : `CONFIRM OVERRIDE — ${outcome ? 'TRIGGER FIRED' : 'NO TRIGGER'}`}
        </button>

        {contractId && outcome !== null && (
          <p className="text-center text-[12px] text-insu-muted">
            This will immediately settle the contract{outcome ? ` and queue Stripe payouts for ${summary?.hedgerCount ?? '?'} hedgers` : ''}.
          </p>
        )}
      </form>
    </div>
  )
}
