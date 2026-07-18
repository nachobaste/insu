'use client'

import { useState, useMemo } from 'react'
import StatsBar from '@/components/contracts/StatsBar'
import ContractSection from '@/components/contracts/ContractSection'
import ContractCard from '@/components/contracts/ContractCard'
import ComingSoonSection from '@/components/contracts/ComingSoonSection'
import TrendingSection from '@/components/contracts/TrendingSection'
import RegionToggle from '@/components/contracts/RegionToggle'
import { useRealtimeContracts } from '@/hooks/useRealtimeContracts'
import { scoreTrending } from '@/lib/trending'
import { filterByRegion, type Region } from '@/lib/region'
import { partitionByLaunchStage, groupLiveContracts } from '@/lib/launch'
import { useSearch } from '@/lib/search-context'
import type { ContractWithTiers } from '@/lib/types'
import type { DisplayMode } from '@/lib/currency/config'

interface Props {
  initialContracts: ContractWithTiers[]
  stats: {
    totalVolumeUsd: number
    activeContracts: number
    protectionsSold: number
    avgPayoutMinutes: number
  }
  displayMode: DisplayMode
}

export default function BrowseClient({ initialContracts, stats, displayMode }: Props) {
  const [region, setRegion] = useState<Region>('MX')
  const allContracts = useRealtimeContracts(initialContracts)
  // Scope everything below (trending, sections, search) to the selected
  // region. Mexico is the demo focus; International is one click away.
  const contracts = useMemo(() => filterByRegion(allContracts, region), [allContracts, region])
  const { live, comingSoon } = useMemo(() => partitionByLaunchStage(contracts), [contracts])
  const groups = useMemo(() => groupLiveContracts(live), [live])
  const trendingContracts = useMemo(() => scoreTrending(live), [live])
  const { query } = useSearch()

  const normalizedQuery = query.trim().toLowerCase()
  const isSearching = normalizedQuery.length > 0

  const searchResults = useMemo(() => {
    if (normalizedQuery.length === 0) return []
    return contracts.filter((c) =>
      c.title.toLowerCase().includes(normalizedQuery) ||
      (c.description ?? '').toLowerCase().includes(normalizedQuery) ||
      (c.location?.city ?? '').toLowerCase().includes(normalizedQuery) ||
      (c.location?.country ?? '').toLowerCase().includes(normalizedQuery) ||
      (c.category?.name ?? '').toLowerCase().includes(normalizedQuery)
    )
  }, [contracts, normalizedQuery])

  return (
    <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 sm:py-7 lg:px-8">
      <div className="mb-5">
        <RegionToggle region={region} onSelect={setRegion} />
      </div>

      <StatsBar stats={stats} />

      {isSearching ? (
        <>
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-insu-muted">
            {searchResults.length === 0
              ? `No results for "${query}"`
              : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'} for "${query}"`}
          </p>
          {searchResults.length === 0 ? (
            <p className="py-16 text-center text-[13px] text-insu-dim">
              Try searching for a city, event, or risk type.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {searchResults.map((contract) => (
                <ContractCard
                  key={contract.id}
                  contract={contract}
                  displayMode={displayMode}
                  comingSoon={contract.launch_stage === 'coming_soon'}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {trendingContracts.length >= 2 && (
            <TrendingSection contracts={trendingContracts} displayMode={displayMode} />
          )}

          {groups.map((group) => (
            <ContractSection
              key={group.key}
              title={group.title}
              categorySlug={group.categorySlug}
              icon={group.icon}
              description={group.description}
              contracts={group.contracts}
              displayMode={displayMode}
            />
          ))}

          <ComingSoonSection contracts={comingSoon} displayMode={displayMode} />
        </>
      )}
    </main>
  )
}
