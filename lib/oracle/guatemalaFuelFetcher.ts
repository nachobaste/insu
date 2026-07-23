// Guatemala has no per-station feed; MEM sets one weekly reference price per
// department (GTQ/gallon). AGN (state news agency) republishes that table weekly
// in its open WordPress REST API. We parse the regular-gasoline figure from the
// prose, with a freshness window + plausibility bounds, and THROW on any failure
// so the poller skips the write rather than storing a bad price. No fallback source.
const AGN_URL =
  'https://agn.gt/wp-json/wp/v2/posts?search=precios%20combustibles&per_page=5&orderby=date'

const FRESH_DAYS = 14
const FETCH_TIMEOUT_MS = 30_000
const BOUNDS = { min: 20, max: 80 } // GTQ per US gallon

type FuelType = 'regular' | 'superior' | 'diesel'

export interface AgnPost {
  title: { rendered: string }
  content: { rendered: string }
  date_gmt: string
}

interface FetchedReading {
  source: 'agn_mem'
  reading_type: 'fuel'
  value: {
    gas_price_quetzales: number
    fuel_type: 'regular'
    reference_week: string
  }
}

/** Pull the regular-gasoline GTQ/gallon figure out of the AGN prose, or null. */
export function parseRegularPriceGTQ(html: string): number | null {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x?[0-9a-f]+;/gi, ' ')
    .replace(/\s+/g, ' ')
  const patterns = [
    // "31.09 para la regular" / "31.09 quetzales para la gasolina regular"
    /(\d{2}\.\d{2})\s*(?:quetzales?\s+)?para\s+la\s+(?:gasolina\s+)?regular/i,
    // "la regular en Q40.09" / "regular Q40.09"
    /(?:la\s+)?regular\s+(?:en\s+)?Q?\s*(\d{2}\.\d{2})/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const v = parseFloat(m[1])
      if (!isNaN(v)) return v
    }
  }
  return null
}

/** Most recent AGN post that is the weekly price series AND within the freshness window. */
export function pickFreshPricePost(posts: AgnPost[], nowMs: number): AgnPost | null {
  const maxAgeMs = FRESH_DAYS * 86_400_000
  for (const p of posts) {
    const title = (p.title?.rendered ?? '').toLowerCase()
    const isSeries = title.includes('quedaron los precios')
    const publishedMs = Date.parse(p.date_gmt.endsWith('Z') ? p.date_gmt : `${p.date_gmt}Z`)
    const fresh = Number.isFinite(publishedMs) && nowMs - publishedMs <= maxAgeMs
    if (isSeries && fresh) return p
  }
  return null
}

// Only 'regular' is oracle-backed today. The wider union + guard is deliberate
// defensive validation: `trigger_condition.fuel_type` comes from the DB as an
// untyped string, so an unexpected value throws (poller skips the write) rather
// than silently pricing the wrong fuel.
export async function fetchGuatemalaFuelPrice(fuelType: FuelType): Promise<FetchedReading> {
  if (fuelType !== 'regular') {
    throw new Error(`GT fuel oracle only supports 'regular', got '${fuelType}'`)
  }
  const res = await fetch(AGN_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`AGN feed error: ${res.status}`)

  const posts = (await res.json()) as AgnPost[]
  const post = pickFreshPricePost(posts, Date.now())
  if (!post) throw new Error('AGN: no fresh fuel-price post within 14 days')

  const price = parseRegularPriceGTQ(post.content.rendered)
  if (price === null) throw new Error('AGN: could not parse regular price')
  if (price < BOUNDS.min || price > BOUNDS.max) {
    throw new Error(`AGN: regular price ${price} out of bounds [${BOUNDS.min}, ${BOUNDS.max}]`)
  }

  return {
    source: 'agn_mem',
    reading_type: 'fuel',
    value: {
      gas_price_quetzales: price,
      fuel_type: 'regular',
      reference_week: post.date_gmt.slice(0, 10),
    },
  }
}
