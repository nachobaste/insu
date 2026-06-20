'use client'

import { Search, X } from 'lucide-react'
import { useSearch } from '@/lib/search-context'

export default function SearchInput() {
  const { query, setQuery } = useSearch()

  return (
    <>
      <Search size={13} className="flex-shrink-0 text-insu-muted" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search contracts"
        placeholder="Search contracts, events, locations…"
        className="w-full min-w-0 flex-1 bg-transparent font-body text-[13.5px] text-insu-text outline-none placeholder:text-insu-muted"
      />
      {query && (
        <button
          onClick={() => setQuery('')}
          aria-label="Clear search"
          className="flex-shrink-0 text-insu-muted transition-colors hover:text-insu-text"
        >
          <X size={13} />
        </button>
      )}
    </>
  )
}
