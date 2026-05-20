// lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Currency } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency: Currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatVolume(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}m`
  if (usd >= 1_000)     return `$${(usd / 1_000).toFixed(0)}k`
  return `$${usd}`
}

export function categoryColorClass(slug: string): string {
  const map: Record<string, string> = {
    urban:       'text-category-urban border-category-urban',
    nature:      'text-category-nature border-category-nature',
    experiences: 'text-category-experiences border-category-experiences',
    events:      'text-category-events border-category-events',
  }
  return map[slug] ?? ''
}

export function countryFlag(code: string | undefined | null): string {
  if (!code || code.length < 2) return ''
  return Array.from(code.toUpperCase().slice(0, 2))
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('')
}

export function categoryTextClass(slug: string): string {
  const map: Record<string, string> = {
    urban:       'text-category-urban',
    nature:      'text-category-nature',
    experiences: 'text-category-experiences',
    events:      'text-category-events',
  }
  return map[slug] ?? 'text-insu-muted'
}
