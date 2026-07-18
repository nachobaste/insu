'use client'

import { useState } from 'react'
import ContractCard from './ContractCard'
import CorridorPairCard from './CorridorPairCard'
import AddContractCard from './AddContractCard'
import { cn } from '@/lib/utils'
import { getContractPeriod, getRecommendedPeriod, getUrbanRoads } from '@/lib/corridors'
import type { ContractWithTiers } from '@/lib/types'
import type { DisplayMode } from '@/lib/currency/config'

const SECTION_STYLES: Record<string, string> = {
  urban:       'text-category-urban',
  nature:      'text-category-nature',
  experiences: 'text-category-experiences',
  events:      'text-category-events',
}

const SECTION_DESCRIPTIONS: Record<string, string> = {
  urban:       'City disruptions · Infrastructure · Mobility',
  nature:      'Weather · Earthquakes · Temperature extremes',
  experiences: 'Travel · Outdoor activities · Vacations',
  events:      'Concerts · Conferences · Public gatherings',
}

const SECTION_ICONS: Record<string, string> = {
  urban:       '🏙️',
  nature:      '🌿',
  experiences: '🎿',
  events:      '🎤',
}

const CHIP_BASE = 'rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors'
const CHIP_ACTIVE = 'border-category-urban/30 bg-category-urban/10 text-category-urban'
const CHIP_INACTIVE = 'border-white/10 text-insu-muted hover:text-insu-text hover:border-white/20'

interface Props {
  title: string
  categorySlug: string
  /** Falls back to the per-slug SECTION_ICONS / SECTION_DESCRIPTIONS maps. */
  icon?: string
  description?: string
  contracts: ContractWithTiers[]
  displayMode: DisplayMode
}

export default function ContractSection({
  title,
  categorySlug,
  icon,
  description,
  contracts,
  displayMode,
}: Props) {
  const [activeRoad, setActiveRoad] = useState<string | null>(null)

  const roads = categorySlug === 'urban' ? getUrbanRoads(contracts) : []
  const recommendedPeriod = getRecommendedPeriod()

  function getBadge(contract: ContractWithTiers) {
    if (contract.corridor && getContractPeriod(contract.corridor) === recommendedPeriod) {
      return 'recommended' as const
    }
    return contract.is_featured ? 'trending' as const : undefined
  }

  const showGrouped = categorySlug === 'urban' && !activeRoad

  // Contracts to show when a road chip is active
  const filteredContracts = activeRoad
    ? contracts.filter((c) => c.corridor?.road === activeRoad)
    : contracts

  // Build road groups for the grouped view
  const byRoad = new Map<string, ContractWithTiers[]>()
  if (showGrouped) {
    for (const c of contracts) {
      const road = c.corridor?.road
      if (!road) continue
      if (!byRoad.has(road)) byRoad.set(road, [])
      byRoad.get(road)!.push(c)
    }
  }

  const nonCorridorContracts = contracts.filter((c) => !c.corridor?.road)

  return (
    <section className="mt-9 first:mt-0">
      <div className="mb-4 flex items-baseline gap-3">
        <h2
          className={cn(
            'font-display text-[28px] tracking-[2px]',
            SECTION_STYLES[categorySlug] ?? ''
          )}
        >
          {icon ?? SECTION_ICONS[categorySlug]} {title}
        </h2>
        <p className="text-[13px] font-medium tracking-[0.05em] text-insu-muted">
          {description ?? SECTION_DESCRIPTIONS[categorySlug]}
        </p>
        <div className="h-px flex-1 bg-white/[0.07]" />
      </div>

      {roads.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveRoad(null)}
            className={cn(CHIP_BASE, activeRoad === null ? CHIP_ACTIVE : CHIP_INACTIVE)}
          >
            All
          </button>
          {roads.map((road) => (
            <button
              key={road}
              onClick={() => setActiveRoad(activeRoad === road ? null : road)}
              className={cn(CHIP_BASE, activeRoad === road ? CHIP_ACTIVE : CHIP_INACTIVE)}
            >
              {road}
            </button>
          ))}
        </div>
      )}

      {showGrouped ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {roads.map((road) => {
            const group = byRoad.get(road) ?? []
            const morning = group.find((c) => c.corridor && getContractPeriod(c.corridor) === 'morning') ?? null
            const evening = group.find((c) => c.corridor && getContractPeriod(c.corridor) === 'evening') ?? null
            return (
              <CorridorPairCard
                key={road}
                morning={morning}
                evening={evening}
                displayMode={displayMode}
              />
            )
          })}
          {nonCorridorContracts.map((contract) => (
            <ContractCard
              key={contract.id}
              contract={contract}
              displayMode={displayMode}
              badge={getBadge(contract)}
            />
          ))}
          <AddContractCard />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filteredContracts.map((contract) => (
            <ContractCard
              key={contract.id}
              contract={contract}
              displayMode={displayMode}
              badge={getBadge(contract)}
            />
          ))}
          <AddContractCard />
        </div>
      )}
    </section>
  )
}
