'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { upsertContract } from '@/lib/actions/admin'
import { cn } from '@/lib/utils'
import type { Category, ContractWithTiers, UpsertContractInput } from '@/lib/types'

const WEATHER_METRICS = ['rainfall', 'temperature', 'wind', 'snow']
const URBAN_METRICS = ['delay', 'congestion']
const FUEL_TYPES = ['magna', 'premium', 'diesel'] as const
const COMPARATORS = ['>', '>=', '<', '<='] as const
const SYMBOL_TO_OPERATOR: Record<string, 'gt' | 'gte' | 'lt' | 'lte'> = {
  '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte',
}
const OPERATOR_TO_SYMBOL: Record<string, string> = {
  gt: '>', gte: '>=', lt: '<', lte: '<=',
}

function buildTriggerCondition(
  type: string,
  state: { metric: string; comparator: string; threshold: string; unit: string; description: string; fuel_type: string },
): Record<string, unknown> {
  if (type === 'weather' || type === 'urban') {
    return {
      metric: state.metric,
      operator: SYMBOL_TO_OPERATOR[state.comparator] ?? 'gt',
      threshold: Number(state.threshold),
      unit: state.unit,
    }
  }
  if (type === 'fuel') {
    return {
      metric: 'price_mxn_per_liter',
      operator: SYMBOL_TO_OPERATOR[state.comparator] ?? 'gt',
      threshold: Number(state.threshold),
      fuel_type: state.fuel_type,
      region: 'cdmx',
    }
  }
  if (type === 'event') return { description: state.description }
  return {}
}

function parseTriggerCondition(
  type: string,
  condition: Record<string, unknown>,
) {
  if (type === 'weather' || type === 'urban') {
    const operator = String(condition.operator ?? condition.comparator ?? 'gt')
    const comparator = OPERATOR_TO_SYMBOL[operator] ?? operator
    return {
      metric: String(condition.metric ?? ''),
      comparator,
      threshold: String(condition.threshold ?? ''),
      unit: String(condition.unit ?? ''),
      description: '',
      fuel_type: '',
    }
  }
  if (type === 'fuel') {
    const operator = String(condition.operator ?? 'gt')
    return {
      metric: 'price_mxn_per_liter',
      comparator: OPERATOR_TO_SYMBOL[operator] ?? '>',
      threshold: String(condition.threshold ?? ''),
      unit: '',
      description: '',
      fuel_type: String(condition.fuel_type ?? 'magna'),
    }
  }
  if (type === 'event') {
    return { metric: '', comparator: '>', threshold: '', unit: '', description: String(condition.description ?? ''), fuel_type: '' }
  }
  return { metric: '', comparator: '>', threshold: '', unit: '', description: '', fuel_type: '' }
}

interface Props {
  categories: Category[]
  contract?: ContractWithTiers
}

export function ContractForm({ categories, contract }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState(contract?.title ?? '')
  const [description, setDescription] = useState(contract?.description ?? '')
  const [categoryId, setCategoryId] = useState(contract?.category_id ?? categories[0]?.id ?? '')
  const [status, setStatus] = useState<string>(contract?.status ?? 'pending')
  const [triggerType, setTriggerType] = useState<string>(contract?.trigger_type ?? 'weather')
  const [deadline, setDeadline] = useState(
    contract?.trigger_deadline
      ? new Date(contract.trigger_deadline).toISOString().split('T')[0]
      : '',
  )
  const [locationCity, setLocationCity] = useState(contract?.location?.city ?? '')
  const [locationCountry, setLocationCountry] = useState(contract?.location?.country ?? '')
  const [locationLat, setLocationLat] = useState(String(contract?.location?.lat ?? ''))
  const [locationLng, setLocationLng] = useState(String(contract?.location?.lng ?? ''))
  const [iconUrl, setIconUrl] = useState(contract?.icon_url ?? '')
  const [isFeatured, setIsFeatured] = useState(contract?.is_featured ?? false)
  const [isRecurring, setIsRecurring] = useState(contract?.is_recurring ?? false)

  const [condState, setCondState] = useState(() =>
    parseTriggerCondition(contract?.trigger_type ?? 'weather', (contract?.trigger_condition as Record<string, unknown>) ?? {}),
  )

  const basicTier = contract?.coverage_tiers?.find((t) => t.name === 'basic')
  const premiumTier = contract?.coverage_tiers?.find((t) => t.name === 'premium')
  const [basicPremium, setBasicPremium] = useState(String(basicTier?.premium_usd ?? ''))
  const [basicPayout, setBasicPayout] = useState(String(basicTier?.payout_usd ?? ''))
  const [basicCapacity, setBasicCapacity] = useState(String(basicTier?.max_capacity_usd ?? ''))
  const [premPremium, setPremPremium] = useState(String(premiumTier?.premium_usd ?? ''))
  const [premPayout, setPremPayout] = useState(String(premiumTier?.payout_usd ?? ''))
  const [premCapacity, setPremCapacity] = useState(String(premiumTier?.max_capacity_usd ?? ''))

  function handleTypeChange(newType: string) {
    setTriggerType(newType)
    setCondState({ metric: '', comparator: '>', threshold: '', unit: '', description: '', fuel_type: newType === 'fuel' ? 'magna' : '' })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const input: UpsertContractInput = {
      ...(contract?.id ? { id: contract.id } : {}),
      title,
      description: description || null,
      category_id: categoryId,
      status: status as UpsertContractInput['status'],
      trigger_type: triggerType as UpsertContractInput['trigger_type'],
      trigger_condition: buildTriggerCondition(triggerType, condState),
      trigger_deadline: isRecurring ? null : new Date(deadline).toISOString(),
      is_recurring: isRecurring,
      location: {
        city: locationCity, country: locationCountry,
        lat: Number(locationLat), lng: Number(locationLng),
      },
      icon_url: iconUrl || null,
      is_featured: isFeatured,
      basic_tier: { premium_usd: Number(basicPremium), payout_usd: Number(basicPayout), max_capacity_usd: Number(basicCapacity) },
      premium_tier: { premium_usd: Number(premPremium), payout_usd: Number(premPayout), max_capacity_usd: Number(premCapacity) },
    }

    startTransition(async () => {
      try {
        await upsertContract(input)
        router.push('/admin/contracts')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed')
      }
    })
  }

  const inputCls = 'w-full rounded-md border border-white/[0.07] bg-bg px-3 py-2 text-sm text-insu-text placeholder:text-insu-muted focus:border-insu-accent/40 focus:outline-none'
  const labelCls = 'mb-1 block text-[11px] uppercase tracking-wider text-insu-muted'
  const selectCls = inputCls + ' cursor-pointer'

  const isUserSubmission = contract?.status === 'pending'
    && !!(contract?.trigger_condition as Record<string, unknown>)?._user_submission

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-5">
      <h1 className="font-display text-2xl tracking-wide text-insu-text">
        {contract ? (isUserSubmission ? 'Review Submission' : 'Edit Contract') : 'New Contract'}
      </h1>

      {isUserSubmission && (
        <div className="rounded-md border border-insu-accent/30 bg-insu-accent/[0.06] px-4 py-3 text-sm">
          <p className="mb-1 font-semibold text-insu-accent">User submission</p>
          <p className="text-insu-dim">
            This contract was submitted by a user. Review the pitch below, fill in the trigger condition and coverage tiers, then set status to <strong className="text-insu-text">active</strong> to publish it.
          </p>
          {!!(contract?.trigger_condition as Record<string, unknown>)?.description && (
            <p className="mt-2 rounded bg-black/20 px-3 py-2 font-mono text-[12px] text-insu-muted">
              Pitch: &quot;{String((contract.trigger_condition as Record<string, unknown>).description)}&quot;
            </p>
          )}
          {!!(contract?.trigger_condition as Record<string, unknown>)?.proposed_payout && (
            <p className="mt-1 font-mono text-[12px] text-insu-muted">
              Proposed payout: ${String((contract.trigger_condition as Record<string, unknown>).proposed_payout)}
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      <div>
        <label className={labelCls}>Title</label>
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>

      <div>
        <label className={labelCls}>Description</label>
        <textarea className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Category</label>
          <select className={selectCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            {['active', 'pending', 'settled', 'cancelled'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Trigger type</label>
          <select className={selectCls} value={triggerType} onChange={(e) => handleTypeChange(e.target.value)}>
            {['weather', 'urban', 'fuel', 'event', 'manual'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        {!isRecurring && (
          <div>
            <label className={labelCls}>Deadline</label>
            <input type="date" className={inputCls} value={deadline} onChange={(e) => setDeadline(e.target.value)} required />
          </div>
        )}
      </div>

      {/* Trigger condition block */}
      <div className="rounded-lg border border-insu-accent/20 bg-insu-accent/[0.03] p-4">
        <p className="mb-3 text-[11px] uppercase tracking-wider text-insu-accent">
          Trigger Condition — {triggerType}
        </p>

        {(triggerType === 'weather' || triggerType === 'urban') && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Metric</label>
              <select className={selectCls} value={condState.metric} onChange={(e) => setCondState((s) => ({ ...s, metric: e.target.value }))}>
                {(triggerType === 'weather' ? WEATHER_METRICS : URBAN_METRICS).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Comparator</label>
              <select className={selectCls} value={condState.comparator} onChange={(e) => setCondState((s) => ({ ...s, comparator: e.target.value }))}>
                {COMPARATORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Threshold</label>
              <input className={inputCls} placeholder="e.g. 25" value={condState.threshold} onChange={(e) => setCondState((s) => ({ ...s, threshold: e.target.value }))} />
            </div>
            <div className="col-span-3">
              <label className={labelCls}>Unit</label>
              <input className={inputCls} placeholder="e.g. mm/hr, min" value={condState.unit} onChange={(e) => setCondState((s) => ({ ...s, unit: e.target.value }))} />
            </div>
          </div>
        )}

        {triggerType === 'fuel' && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Fuel Type</label>
              <select
                className={selectCls}
                value={condState.fuel_type}
                onChange={(e) => setCondState((s) => ({ ...s, fuel_type: e.target.value }))}
              >
                {FUEL_TYPES.map((f) => (
                  <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Comparator</label>
              <select
                className={selectCls}
                value={condState.comparator}
                onChange={(e) => setCondState((s) => ({ ...s, comparator: e.target.value }))}
              >
                {['>', '>=', '<', '<='].map((op) => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Threshold (MXN/liter)</label>
              <input
                className={inputCls}
                type="number"
                step="0.01"
                placeholder="e.g. 26.50"
                value={condState.threshold}
                onChange={(e) => setCondState((s) => ({ ...s, threshold: e.target.value }))}
              />
            </div>
            <p className="text-xs text-insu-dim">Region: CDMX (fixed)</p>
          </div>
        )}

        {triggerType === 'event' && (
          <div>
            <label className={labelCls}>Condition description</label>
            <input className={inputCls} placeholder="e.g. Stadium capacity exceeds 90%" value={condState.description} onChange={(e) => setCondState((s) => ({ ...s, description: e.target.value }))} />
          </div>
        )}

        {triggerType === 'manual' && (
          <p className="text-sm text-insu-muted">No oracle condition — settlement is triggered manually via the Trigger Override section.</p>
        )}
      </div>

      {/* Location */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>City</label>
          <input className={inputCls} value={locationCity} onChange={(e) => setLocationCity(e.target.value)} required />
        </div>
        <div>
          <label className={labelCls}>Country</label>
          <input className={inputCls} value={locationCountry} onChange={(e) => setLocationCountry(e.target.value)} required />
        </div>
        <div>
          <label className={labelCls}>Latitude</label>
          <input className={inputCls} type="number" step="any" value={locationLat} onChange={(e) => setLocationLat(e.target.value)} required />
        </div>
        <div>
          <label className={labelCls}>Longitude</label>
          <input className={inputCls} type="number" step="any" value={locationLng} onChange={(e) => setLocationLng(e.target.value)} required />
        </div>
      </div>

      {/* Icon URL */}
      <div>
        <label className={labelCls}>Icon URL (optional)</label>
        <input className={inputCls} value={iconUrl} onChange={(e) => setIconUrl(e.target.value)} placeholder="https://..." />
      </div>

      {/* Coverage tiers */}
      <div className="rounded-lg border border-white/[0.07] p-4">
        <p className="mb-3 text-[11px] uppercase tracking-wider text-insu-muted">Coverage Tiers (USD)</p>
        <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-3 mb-2">
          <div />
          <span className="text-[11px] uppercase tracking-wider text-insu-muted">Premium</span>
          <span className="text-[11px] uppercase tracking-wider text-insu-muted">Payout</span>
          <span className="text-[11px] uppercase tracking-wider text-insu-muted">Max Capacity</span>
        </div>
        <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-3 mb-2 items-center">
          <span className="text-sm text-insu-dim">Basic</span>
          <input className={inputCls} type="number" min="0" step="0.01" value={basicPremium} onChange={(e) => setBasicPremium(e.target.value)} required />
          <input className={inputCls} type="number" min="0" step="0.01" value={basicPayout} onChange={(e) => setBasicPayout(e.target.value)} required />
          <input className={inputCls} type="number" min="0" value={basicCapacity} onChange={(e) => setBasicCapacity(e.target.value)} required />
        </div>
        <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-3 items-center">
          <span className="text-sm text-insu-dim">Premium</span>
          <input className={inputCls} type="number" min="0" step="0.01" value={premPremium} onChange={(e) => setPremPremium(e.target.value)} required />
          <input className={inputCls} type="number" min="0" step="0.01" value={premPayout} onChange={(e) => setPremPayout(e.target.value)} required />
          <input className={inputCls} type="number" min="0" value={premCapacity} onChange={(e) => setPremCapacity(e.target.value)} required />
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} className="rounded" />
          <span className="text-sm text-insu-dim">Featured on homepage</span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-[13px] font-medium text-insu-text">Recurring contract</label>
        <button
          type="button"
          onClick={() => setIsRecurring(v => !v)}
          className={cn(
            'relative h-6 w-11 rounded-full transition-colors',
            isRecurring ? 'bg-insu-accent' : 'bg-white/10',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
              isRecurring ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
        </button>
        <span className="text-[12px] text-insu-muted">
          {isRecurring ? 'Rolls over (no deadline)' : 'One-time event (expires at deadline)'}
        </span>
      </div>

      <div className="flex gap-3 justify-end pt-2">
        <button
          type="button"
          onClick={() => router.push('/admin/contracts')}
          className="rounded-md border border-white/[0.07] px-4 py-2 text-sm text-insu-dim hover:text-insu-text"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-insu-accent px-5 py-2 text-sm font-bold text-bg disabled:opacity-60 hover:bg-[#f7b84a]"
        >
          {isPending ? 'Saving…' : 'Save Contract'}
        </button>
      </div>
    </form>
  )
}
