// lib/currency/config.ts

/** Currencies we can display a contract's local price in. */
export type LocalCurrency = 'MXN' | 'GTQ'
export type DisplayCurrency = 'USD' | LocalCurrency
/** User preference: universal USD, or each contract's own local currency. */
export type DisplayMode = 'USD' | 'LOCAL'

/** Local units per 1 USD. Code constants (display-only); update as rates drift. */
export const FX_RATES: Record<LocalCurrency, number> = {
  MXN: 17.0,
  GTQ: 7.75,
}

/** ISO-3166 alpha-2 country -> its local currency. Countries absent here show USD. */
export const COUNTRY_CURRENCY: Record<string, LocalCurrency> = {
  MX: 'MXN',
  GT: 'GTQ',
}
