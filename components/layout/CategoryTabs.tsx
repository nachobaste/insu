'use client'

import { cn } from '@/lib/utils'
import type { Category } from '@/lib/types'

const SLUG_STYLES: Record<string, string> = {
  urban:       'text-category-urban border-b-category-urban',
  nature:      'text-category-nature border-b-category-nature',
  experiences: 'text-category-experiences border-b-category-experiences',
  events:      'text-category-events border-b-category-events',
}

const DOT_STYLES: Record<string, string> = {
  urban:       'bg-category-urban',
  nature:      'bg-category-nature',
  experiences: 'bg-category-experiences',
  events:      'bg-category-events',
}

interface Props {
  categories: Category[]
  activeSlug: string
  onSelect: (slug: string) => void
}

export default function CategoryTabs({ categories, activeSlug, onSelect }: Props) {
  return (
    <nav
      role="tablist"
      aria-label="Contract categories"
      className="flex overflow-x-auto border-b border-white/[0.07] bg-bg/70 px-8 scrollbar-none backdrop-blur-md"
    >
      {categories.map((cat) => {
        const isActive = cat.slug === activeSlug
        return (
          <button
            key={cat.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(cat.slug)}
            className={cn(
              'flex h-[46px] flex-shrink-0 items-center gap-2 border-b-2 px-5 text-xs font-bold uppercase tracking-[0.12em] transition-colors',
              isActive
                ? cn('border-b-2', SLUG_STYLES[cat.slug])
                : 'border-transparent text-insu-muted hover:text-insu-text'
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                isActive ? DOT_STYLES[cat.slug] : 'bg-insu-muted'
              )}
            />
            {cat.name}
          </button>
        )
      })}

      <div className="ml-auto flex">
        {['Trending', 'Ending Soon', 'New'].map((label) => (
          <button
            key={label}
            className="flex h-[46px] items-center px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-insu-muted transition-colors hover:text-insu-text"
          >
            {label}
          </button>
        ))}
      </div>
    </nav>
  )
}
