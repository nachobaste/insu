'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { injectReading, type InjectResult } from '@/lib/actions/oracle/injectReading'
import type { Contract } from '@/lib/types'
import type { TriggerCondition } from '@/lib/oracle/trigger'

interface Props {
  contracts: Contract[]
}

const inputCls =
  'w-full rounded-md border border-white/[0.07] bg-bg px-3 py-2 text-sm text-insu-text focus:border-insu-accent/40 focus:outline-none'
const labelCls = 'mb-1 block text-[11px] uppercase tracking-wider text-insu-muted'

function operatorSymbol(op: string) {
  return op === 'gte' ? '≥' : op === 'lte' ? '≤' : op === 'gt' ? '>' : '<'
}

function defaultJson(condition: TriggerCondition | null): string {
  if (!condition?.metric) return '{}'
  return JSON.stringify({ [condition.metric]: condition.threshold }, null, 2)
}

export function ScenarioPanel({ contracts }: Props) {
  const [contractId, setContractId] = useState('')
  const [valueJson, setValueJson] = useState('{}')
  const [source, setSource] = useState('manual')
  const [result, setResult] = useState<InjectResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const selectedContract = contracts.find((c) => c.id === contractId)
  const condition = selectedContract
    ? (selectedContract.trigger_condition as unknown as TriggerCondition)
    : null

  function handleContractChange(id: string) {
    setContractId(id)
    setResult(null)
    setError(null)
    const contract = contracts.find((c) => c.id === id)
    const cond = contract ? (contract.trigger_condition as unknown as TriggerCondition) : null
    setValueJson(defaultJson(cond))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!contractId) return
    setError(null)
    setResult(null)

    startTransition(async () => {
      const res = await injectReading(contractId, valueJson, source || 'manual')
      if (!res.ok) {
        setError(res.error)
      } else {
        setResult(res)
      }
    })
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-1 font-display text-2xl tracking-wide text-insu-text">Scenario Panel</h1>
      <p className="mb-6 text-sm text-insu-muted">
        Inject a manual oracle reading to simulate a trigger condition — for demos and testing.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className={labelCls}>Contract</label>
          <select
            className={inputCls + ' cursor-pointer'}
            value={contractId}
            onChange={(e) => handleContractChange(e.target.value)}
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

        {condition && (
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-3">
            <p className={labelCls}>Trigger condition</p>
            <p className="font-mono text-sm text-insu-text">
              {condition.metric}{' '}
              <span className="text-insu-accent">{operatorSymbol(condition.operator)}</span>{' '}
              {condition.threshold}
            </p>
          </div>
        )}

        <div>
          <label className={labelCls}>Reading value (JSON)</label>
          <textarea
            className={inputCls + ' font-mono'}
            rows={5}
            value={valueJson}
            onChange={(e) => setValueJson(e.target.value)}
            spellCheck={false}
            required
          />
        </div>

        <div>
          <label className={labelCls}>Source label</label>
          <input
            className={inputCls}
            type="text"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="manual"
          />
        </div>

        {error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!contractId || isPending}
          className="w-full rounded-md bg-insu-accent py-2.5 text-sm font-bold tracking-wide text-bg disabled:opacity-40 hover:bg-[#f7b84a]"
        >
          {isPending ? 'Injecting…' : 'Inject Reading'}
        </button>
      </form>

      {result && (
        <div className="mt-6 space-y-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-insu-muted">
            ✓ Reading written
          </p>

          {result.trigger_met ? (
            <div className="space-y-1">
              <p className="text-sm font-bold text-insu-green">TRIGGER MET: YES</p>
              <p className="font-mono text-sm text-insu-dim">
                {result.metric} = {result.actual_value}{' '}
                <span className="text-insu-accent">{operatorSymbol(result.operator)}</span>{' '}
                threshold {result.threshold}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-bold text-insu-dim">TRIGGER NOT MET</p>
              <p className="font-mono text-sm text-insu-dim">
                {result.metric} = {result.actual_value}{' '}
                <span className="text-insu-accent">{operatorSymbol(result.operator)}</span>{' '}
                threshold {result.threshold} ✗
              </p>
              <p className="text-xs text-insu-muted">
                Trigger condition was not satisfied — contract remains active.
              </p>
            </div>
          )}

          <Link
            href={`/admin/trigger?contract=${result.contract_slug}`}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-insu-accent/30 bg-insu-accent/5 px-4 py-2 text-sm font-semibold text-insu-accent transition-colors hover:bg-insu-accent/10"
          >
            Settle this contract now →
          </Link>
        </div>
      )}
    </div>
  )
}
