'use client'

import { useState, type ReactNode } from 'react'
import { cn, categoryTextClass, countryFlag } from '@/lib/utils'
import { quoteTiers } from '@/lib/pricing/quote'
import type { ContractDetailData, LatestOracleReading } from '@/lib/types'
import type { TriggerCondition } from '@/lib/oracle/trigger'
import ContractMeta from './ContractMeta'
import OracleConditions from './OracleConditions'
import PriceChart from './PriceChart'
import PurchasePanel from './PurchasePanel'
import TierSelector from './TierSelector'

type PanelMode = 'buy' | 'provide'

const PERIOD_OPTIONS = [
  { days: 1,  label: '1 day' },
  { days: 7,  label: '7 days' },
  { days: 30, label: '30 days' },
] as const

interface Props {
  contract: ContractDetailData
  userId: string | null
  latestReading: LatestOracleReading | null
  /** Optional content rendered at the very top of the left column (e.g. period toggle). */
  periodToggle?: ReactNode
  /** Optional content rendered below the description, above the price chart (e.g. corridor evidence). */
  evidence?: ReactNode
}

export default function ContractDetailClient({ contract, userId, latestReading, periodToggle, evidence }: Props) {
  const isRecurring = contract.is_recurring

  const [panelOpen, setPanelOpen] = useState(false)
  const [panelMode, setPanelMode] = useState<PanelMode>('buy')
  const [selectedPeriodDays, setSelectedPeriodDays] = useState<number | null>(isRecurring ? 1 : null)
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null)

  const slug = contract.category.slug
  const sortedTiers = [...contract.coverage_tiers].sort((a, b) =>
    a.name === 'basic' ? -1 : b.name === 'basic' ? 1 : 0,
  )

  const rawMultiplier = sortedTiers[0]?.pricing_inputs?.oracleMultiplier
  const oracleMultiplier = typeof rawMultiplier === 'number' ? rawMultiplier : 1.0

  function openPanel(mode: PanelMode) {
    setPanelMode(mode)
    setPanelOpen(true)
  }

  const priceByTier = isRecurring && selectedPeriodDays
    ? quoteTiers(contract.coverage_tiers, selectedPeriodDays, contract.trigger_condition, latestReading)
    : undefined

  // A multi-payout tier (Pro) is meaningless on a 1-day window — only one event can land.
  const lockedReasonByTier = isRecurring && selectedPeriodDays != null && selectedPeriodDays <= 1
    ? Object.fromEntries(
        contract.coverage_tiers
          .filter((t) => t.max_payouts > 1)
          .map((t) => [t.id, 'Needs 7+ days']),
      )
    : undefined

  function selectPeriod(days: number) {
    const next = selectedPeriodDays === days ? null : days
    setSelectedPeriodDays(next)
    // Drop a Pro selection that just became invalid for a 1-day window.
    if (next != null && next <= 1) {
      const current = contract.coverage_tiers.find((t) => t.id === selectedTierId)
      if (current && current.max_payouts > 1) setSelectedTierId(null)
    }
  }

  const hasPoolCoverage = sortedTiers.some(t => t.current_capacity_usd >= t.payout_usd)

  return (
    <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_360px]">
        {/* Left column */}
        <div className="space-y-5">
          {periodToggle}
          <div>
            <span className={cn('text-[12px] font-bold uppercase tracking-[0.12em]', categoryTextClass(slug))}>
              {contract.category.name}
            </span>
            <h1 className="mt-1 text-[24px] font-semibold leading-snug text-insu-text">
              {contract.title}
            </h1>
            {contract.location?.city && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-insu-muted">
                <span aria-hidden="true">{countryFlag(contract.location?.country ?? 'MX')}</span>
                <span>{contract.location.city}</span>
              </p>
            )}
            {contract.description && (
              <p className="mt-2 text-[14px] text-insu-muted">{contract.description}</p>
            )}
          </div>

          {evidence}

          <PriceChart history={contract.pricing_history} tiers={contract.coverage_tiers} />

          {latestReading && (
            <OracleConditions
              reading={latestReading}
              triggerCondition={contract.trigger_condition as unknown as TriggerCondition}
              oracleMultiplier={oracleMultiplier}
            />
          )}

          <ContractMeta contract={contract} />
        </div>

        {/* Right column — sticky on desktop, stacked below lg */}
        <div className="space-y-4 lg:sticky lg:top-[80px]">

          {/* Period selector — oracle-driven contracts only */}
          {isRecurring && (
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-insu-muted">
                Coverage period
              </p>
              <div className="flex gap-2">
                {PERIOD_OPTIONS.map(({ days, label }) => (
                  <button
                    key={days}
                    onClick={() => selectPeriod(days)}
                    className={cn(
                      'flex flex-1 flex-col items-center rounded-lg border py-2.5 text-[12px] font-semibold transition-all',
                      selectedPeriodDays === days
                        ? 'border-insu-accent/50 bg-insu-accent/5 text-insu-accent'
                        : 'border-white/[0.07] bg-bg-card text-insu-muted hover:border-white/15',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="text-[12px] font-semibold uppercase tracking-wider text-insu-muted">
            Select tier
          </p>

          <TierSelector
            tiers={contract.coverage_tiers}
            selectedTierId={selectedTierId}
            onSelect={(id) => setSelectedTierId(prev => prev === id ? null : id)}
            mode="buy"
            priceByTier={priceByTier}
            lockedReasonByTier={lockedReasonByTier}
          />

          <div className="space-y-2 pt-1">
            <button
              onClick={() => openPanel('buy')}
              disabled={!hasPoolCoverage}
              className="w-full rounded-lg bg-insu-accent py-3 text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Buy Protection
            </button>
            <button
              onClick={() => openPanel('provide')}
              className="w-full rounded-lg border border-white/[0.07] bg-bg-card py-3 text-[14px] font-semibold text-insu-text transition-all hover:border-white/15"
            >
              Provide Capital
            </button>
          </div>
        </div>
      </div>

      <PurchasePanel
        contract={contract}
        userId={userId}
        open={panelOpen}
        initialMode={panelMode}
        initialPeriodDays={selectedPeriodDays}
        initialTierId={selectedTierId}
        latestReading={latestReading}
        onClose={() => setPanelOpen(false)}
      />
    </main>
  )
}
