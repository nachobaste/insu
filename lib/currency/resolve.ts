// lib/currency/resolve.ts
import { formatCurrency } from '@/lib/utils'
import {
  COUNTRY_CURRENCY,
  FX_RATES,
  type DisplayCurrency,
  type DisplayMode,
  type LocalCurrency,
} from './config'

/**
 * Country code (or legacy "Mexico") -> local currency, or null if unconfigured.
 * Only "Mexico" was ever stored as a freeform name in production data (one legacy
 * cancelled contract); no such freeform value exists for Guatemala, hence the
 * asymmetric normalization.
 */
export function localCurrencyForCountry(country?: string | null): LocalCurrency | null {
  if (!country) return null
  const raw = country.trim()
  const code = raw.toLowerCase() === 'mexico' ? 'MX' : raw.toUpperCase()
  return COUNTRY_CURRENCY[code] ?? null
}

/** Given the user's mode and a contract's country, pick the display currency. */
export function resolveDisplayCurrency(
  mode: DisplayMode,
  country?: string | null,
): DisplayCurrency {
  if (mode === 'USD') return 'USD'
  return localCurrencyForCountry(country) ?? 'USD'
}

/** Convert an authoritative USD amount into the target display currency. */
export function convertFromUsd(amountUsd: number, currency: DisplayCurrency): number {
  if (currency === 'USD') return amountUsd
  return Math.round(amountUsd * FX_RATES[currency])
}

/**
 * One-call helper for render sites: resolve currency, convert, and format.
 * `amount` is the authoritative numeric value in the display currency — a rounded
 * whole unit for local currencies, and the exact (possibly fractional) USD value
 * in USD mode. `formatted` always renders whole units, so prefer `formatted` for
 * display and treat `amount` as the underlying figure.
 */
export function displayPrice(
  amountUsd: number,
  mode: DisplayMode,
  country?: string | null,
): { amount: number; currency: DisplayCurrency; formatted: string } {
  const currency = resolveDisplayCurrency(mode, country)
  const amount = convertFromUsd(amountUsd, currency)
  return { amount, currency, formatted: formatCurrency(amount, currency) }
}
