'use client'

import { useState, useMemo } from 'react'
import CategoryTabs from '@/components/layout/CategoryTabs'
import StatsBar from '@/components/contracts/StatsBar'
import ContractSection from '@/components/contracts/ContractSection'
import TrendingSection from '@/components/contracts/TrendingSection'
import { useRealtimeContracts } from '@/hooks/useRealtimeContracts'
import { scoreTrending } from '@/lib/trending'
import { useSearch } from '@/lib/search-context'
import type { Category, ContractWithTiers } from '@/lib/types'

interface Props {
  categories: Category[]
  initialContracts: ContractWithTiers[]
  stats: {
    totalVolumeUsd: number
    activeContracts: number
    protectionsSold: number
    avgPayoutMinutes: number
  }
}

export default function BrowseClient({ categories, initialContracts, stats }: Props) {
  const [activeSlug, setActiveSlug] = useState<string>('all')
  const contracts = useRealtimeContracts(initialContracts)
  const trendingContracts = useMemo(() => scoreTrending(contracts), [contracts])
  const { query } = useSearch()

  const normalizedQuery = query.trim().toLowerCase()
  const isSearching = normalizedQuery.length > 0

  const searchResults = useMemo(() => {
    if (!isSearching) return []
    return contracts.filter((c) =>
      c.title.toLowerCase().includes(normalizedQuery) ||
      (c.description ?? '').toLowerCase().includes(normalizedQuery) ||
      (c.location?.city ?? '').toLowerCase().includes(normalizedQuery) ||
      (c.location?.country ?? '').toLowerCase().includes(normalizedQuery) ||
      (c.category?.name ?? '').toLowerCase().includes(normalizedQuery)
    )
  }, [contracts, normalizedQuery, isSearching])

  const visibleCategories =
    activeSlug === 'all'
      ? categories
      : categories.filter((c) => c.slug === activeSlug)

  return (
    <>
      <CategoryTabs
        categories={categories}
        activeSlug={activeSlug}
        onSelect={(slug) => setActiveSlug(slug === activeSlug ? 'all' : slug)}
      />

      <main className="mx-auto max-w-[1320px] px-8 py-7">
        <StatsBar stats={stats} />

        {isSearching ? (
          <>
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-insu-muted">
              {searchResults.length === 0
                ? `No results for "${query}"`
                : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'} for "${query}"`}
            </p>
            {searchResults.length === 0 ? (
              <p className="py-16 text-center text-[13px] text-insu-dim">
                Try searching for a city, event, or risk type.
              </p>
            ) : (
              categories.map((cat) => {
                const catContracts = searchResults.filter((c) => c.category?.slug === cat.slug)
                if (catContracts.length === 0) return null
                return (
                  <ContractSection
                    key={cat.id}
                    categoryName={cat.name}
                    categorySlug={cat.slug}
                    contracts={catContracts}
                    currency="USD"
                  />
                )
              })
            )}
          </>
        ) : (
          <>
            {activeSlug === 'all' && trendingContracts.length >= 2 && (
              <TrendingSection contracts={trendingContracts} currency="USD" />
            )}

            {activeSlug === 'all' && trendingContracts.length >= 2 && (
              <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-insu-muted">
                All contracts
              </p>
            )}

            {visibleCategories.map((cat) => {
              const catContracts = contracts.filter(
                (c) => c.category?.slug === cat.slug
              )
              if (catContracts.length === 0) return null
              return (
                <ContractSection
                  key={cat.id}
                  categoryName={cat.name}
                  categorySlug={cat.slug}
                  contracts={catContracts}
                  currency="USD"
                />
              )
            })}
          </>
        )}
      </main>
    </>
  )
}
