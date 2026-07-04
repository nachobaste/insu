import { formatVolume } from '@/lib/utils'
import type { ContractWithTiers } from '@/lib/types'

interface Props {
  contract: ContractWithTiers
}

const TRIGGER_LABELS: Record<string, string> = {
  weather:     'Weather',
  urban:       'Urban event',
  event:       'Event cancellation',
  manual:      'Manual',
  air_quality: 'Air quality',
  flood:       'Flood',
}

const METRIC_LABELS: Record<string, string> = {
  temp_c: 'Temperature',
  rain_mm: 'Rainfall',
  traffic_index: 'Traffic index',
  price_mxn_per_liter: 'Fuel price',
  wind_kph: 'Wind speed',
  wind_mps: 'Wind speed',
  aqi_imeca: 'IMECA air quality index',
  rain_1h_mm: 'Hourly rainfall',
}

const METRIC_UNITS: Record<string, string> = {
  temp_c: '°C',
  rain_mm: 'mm',
  wind_kph: ' km/h',
  price_mxn_per_liter: ' MXN/L',
  aqi_imeca: '',
  rain_1h_mm: 'mm',
}

const OP_SYMBOLS: Record<string, string> = {
  gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠',
  '>': '>', '>=': '≥', '<': '<', '<=': '≤', '=': '=',
}

function humanize(s: string): string {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** Human-readable summary of a trigger condition — never raw JSON. */
function formatCondition(c: Record<string, unknown>): string {
  if (typeof c.description === 'string' && c.description.trim()) return c.description

  const metric = typeof c.metric === 'string' ? c.metric : undefined
  if (metric && c.threshold != null) {
    const label = METRIC_LABELS[metric] ?? humanize(metric)
    const op = OP_SYMBOLS[String(c.operator)] ?? ''
    const unit = METRIC_UNITS[metric] ?? ''
    return `${label} ${op} ${c.threshold}${unit}`.replace(/\s+/g, ' ').trim()
  }

  if (c.type === 'event_cancellation') {
    return c.event_name ? `${c.event_name} cancelled` : 'Event cancellation'
  }

  if (typeof c.type === 'string') {
    const detail = c.event_name ?? c.river ?? c.source
    return detail ? `${humanize(c.type)} · ${humanize(String(detail))}` : humanize(c.type)
  }

  return 'Custom trigger condition'
}

export default function ContractMeta({ contract }: Props) {
  const deadline = contract.trigger_deadline
    ? new Date(contract.trigger_deadline).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    : '—'
  const condition = contract.trigger_condition as Record<string, unknown>
  const conditionText = formatCondition(condition)
  const { city, country } = contract.location
  const locationText = [city, country].filter(Boolean).join(', ') || '—'

  return (
    <dl className="space-y-3 rounded-card border border-white/[0.07] bg-bg-card p-5 text-[13px]">
      {[
        ['Trigger type',  TRIGGER_LABELS[contract.trigger_type] ?? contract.trigger_type],
        ['Condition',     conditionText],
        ['Deadline',      deadline],
        ['Location',      locationText],
        ['Total volume',  formatVolume(contract.total_volume_usd)],
      ].map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <dt className="flex-shrink-0 text-insu-muted">{label}</dt>
          <dd className="min-w-0 text-right font-medium text-insu-text [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
