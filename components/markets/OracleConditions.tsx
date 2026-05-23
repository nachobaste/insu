import type { LatestOracleReading } from '@/lib/types'
import type { TriggerCondition } from '@/lib/oracle/trigger'

const METRIC_UNITS: Record<string, string> = {
  temp_c: '°C',
  temp_f: '°F',
  rain_mm: 'mm',
  wind_kmh: 'km/h',
  jam_factor: '',
}

const SOURCE_LABELS: Record<string, string> = {
  openweathermap: 'OpenWeatherMap',
  tomorrow_io: 'Tomorrow.io',
  waze: 'Waze',
}

const OPERATOR_LABELS: Record<TriggerCondition['operator'], string> = {
  gte: '≥',
  lte: '≤',
  gt: '>',
  lt: '<',
}

type State = 'low' | 'elevated' | 'met'

const STATE_CONFIG: Record<State, { text: string; bar: string; border: string; dot: string; label: string }> = {
  low: {
    text: 'text-insu-green',
    bar: 'bg-insu-green',
    border: 'border-insu-green/10',
    dot: 'bg-insu-green',
    label: 'Premium discounted',
  },
  elevated: {
    text: 'text-insu-accent',
    bar: 'bg-gradient-to-r from-insu-green to-insu-accent',
    border: 'border-insu-accent/20',
    dot: 'bg-insu-accent',
    label: 'Premium elevated',
  },
  met: {
    text: 'text-red-400',
    bar: 'bg-red-500',
    border: 'border-red-500/20',
    dot: 'bg-red-500',
    label: 'Premium at maximum',
  },
}

function formatAge(readAt: string): string {
  const minsAgo = Math.floor((Date.now() - new Date(readAt).getTime()) / 60000)
  return minsAgo < 60 ? `${minsAgo} min ago` : `${Math.floor(minsAgo / 60)} h ago`
}

interface Props {
  reading: LatestOracleReading
  triggerCondition: TriggerCondition
  oracleMultiplier: number
}

export default function OracleConditions({ reading, triggerCondition, oracleMultiplier }: Props) {
  const actual = reading.value[triggerCondition.metric]
  if (typeof actual !== 'number' || !isFinite(actual)) return null

  const proximity =
    triggerCondition.operator === 'gte' || triggerCondition.operator === 'gt'
      ? actual / triggerCondition.threshold
      : triggerCondition.threshold / actual

  const state: State =
    reading.trigger_met || proximity >= 1.0 ? 'met' : proximity >= 0.6 ? 'elevated' : 'low'
  const displayPct = Math.min(100, Math.round(proximity * 100))
  const impactPct = Math.round((oracleMultiplier - 1) * 100)
  const cfg = STATE_CONFIG[state]

  const unit = METRIC_UNITS[triggerCondition.metric] ?? ''
  const sourceName = SOURCE_LABELS[reading.source] ?? reading.source
  const operatorLabel = OPERATOR_LABELS[triggerCondition.operator]

  return (
    <div className={`rounded-[10px] border bg-bg-card p-[14px_16px] ${cfg.border}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-insu-muted">
          Current conditions
        </span>
        <span className="text-[9px] text-insu-muted/60">
          {sourceName} · {formatAge(reading.read_at)}
        </span>
      </div>

      <div className="mb-2.5 flex items-end gap-2.5">
        <span className={`text-[26px] font-bold leading-none ${cfg.text}`}>
          {actual.toFixed(1)}
        </span>
        <div className="mb-0.5">
          {unit && (
            <div className={`text-[13px] font-semibold leading-none ${cfg.text}`}>{unit}</div>
          )}
          <div className="text-[10px] text-insu-muted">
            Triggers at {operatorLabel} {triggerCondition.threshold}
            {unit ? ` ${unit}` : ''}
          </div>
        </div>
      </div>

      <div className="mb-2.5">
        <div className="mb-1 flex justify-between text-[9px] text-insu-muted">
          <span>Conditions now</span>
          <span className={cfg.text}>
            {state === 'met' ? '⚡ Trigger threshold crossed' : `${displayPct}% to trigger`}
          </span>
        </div>
        <div className="relative h-[5px] overflow-hidden rounded-full bg-white/5">
          <div
            className={`h-full rounded-full ${cfg.bar}`}
            style={{ width: `${state === 'met' ? 100 : displayPct}%` }}
          />
        </div>
      </div>

      {impactPct !== 0 && (
        <div className="flex items-center justify-between border-t border-white/5 pt-2.5">
          <div className="flex items-center gap-1.5">
            <div className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
            <span className="text-[10px] text-insu-muted">{cfg.label}</span>
          </div>
          <span className={`font-mono text-[12px] font-bold ${cfg.text}`}>
            {impactPct > 0 ? '+' : ''}
            {impactPct}% vs baseline
          </span>
        </div>
      )}
    </div>
  )
}
