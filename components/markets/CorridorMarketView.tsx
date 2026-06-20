'use client'

import { useState } from 'react'
import ContractDetailClient from './ContractDetailClient'
import { CorridorEvidence } from './CorridorEvidence'
import { CorridorPeriodSwitch, type PeriodOption } from './CorridorPeriodSwitch'
import type { CommutePeriod, PeriodBundle } from '@/lib/corridors'

interface Props {
  bundles: PeriodBundle[]
  initialPeriod: CommutePeriod
  userId: string | null
}

/**
 * Renders a corridor's morning/evening protections from preloaded bundles,
 * swapping between them client-side with no page reload. Keeps the URL in sync
 * via history.replaceState so refresh/share preserves the selected period.
 */
export function CorridorMarketView({ bundles, initialPeriod, userId }: Props) {
  const [activePeriod, setActivePeriod] = useState<CommutePeriod>(initialPeriod)

  const active = bundles.find((b) => b.period === activePeriod) ?? bundles[0]
  const options: PeriodOption[] = bundles.map((b) => ({
    period: b.period,
    slug: b.slug,
    windowStart: b.corridor.window_start,
  }))

  function handleSelect(period: CommutePeriod) {
    const next = bundles.find((b) => b.period === period)
    if (!next) return
    setActivePeriod(period)
    // replaceState (not router.replace) keeps the swap instant: it syncs the URL
    // without a server round-trip / RSC refetch, which is the whole point here.
    window.history.replaceState(null, '', `/markets/${next.slug}`)
  }

  const { contract, corridor } = active

  return (
    <ContractDetailClient
      key={active.slug}
      contract={contract}
      userId={userId}
      latestReading={active.latestReading}
      periodToggle={
        <CorridorPeriodSwitch active={activePeriod} options={options} onSelect={handleSelect} />
      }
      evidence={
        <CorridorEvidence
          corridor={corridor}
          readings={active.sparklineReadings}
          triggerCondition={contract.trigger_condition}
        />
      }
    />
  )
}
