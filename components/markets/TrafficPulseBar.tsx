import { cn } from '@/lib/utils'
import type { OracleReading } from '@/lib/types'

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function nextWindowLabel(windowStart: string): string {
  return `Next window opens at ${windowStart.substring(0, 5)}`
}

function isCurrentlyInWindow(windowStart: string, windowEnd: string): boolean {
  const now = new Date()
  const mexicoCityTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
  const [nowH, nowM] = mexicoCityTime.split(':').map(Number)
  const nowMinutes = nowH * 60 + nowM
  const [startH, startM] = windowStart.substring(0, 5).split(':').map(Number)
  const [endH, endM] = windowEnd.substring(0, 5).split(':').map(Number)
  // NOTE: windows spanning midnight (e.g. 22:00–02:00) are not supported — all corridors use daytime windows
  return nowMinutes >= startH * 60 + startM && nowMinutes < endH * 60 + endM
}

export function TrafficPulseBar({
  readings,
  threshold,
  windowStart,
  windowEnd,
  triggerDescription,
}: {
  readings: OracleReading[]
  threshold: number
  windowStart: string
  windowEnd: string
  triggerDescription: string
}) {
  const latest = readings[0] ?? null
  const currentIndex = latest
    ? Number((latest.value as Record<string, unknown>).traffic_index ?? 0)
    : null
  const inWindow = isCurrentlyInWindow(windowStart, windowEnd)
  const isTriggered = currentIndex !== null && currentIndex > threshold
  const displayIndex = currentIndex !== null ? Math.min(100, currentIndex) : null

  const barColor =
    currentIndex === null ? 'bg-white/10'
    : currentIndex > threshold ? 'bg-red-500'
    : currentIndex > threshold * 0.6 ? 'bg-yellow-400'
    : 'bg-emerald-400'

  const sparkValues = readings
    .slice(0, 6)
    .reverse()
    .map((r) => Number((r.value as Record<string, unknown>).traffic_index ?? 0))

  const sparkMax = Math.max(...sparkValues, threshold, 1)

  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-insu-muted">Tráfico en vivo</p>
          <p className="mt-0.5 text-[12px] text-insu-dim">{triggerDescription}</p>
        </div>
        <div className="flex items-center gap-2">
          {isTriggered && (
            <span className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-red-400">
              ⚡ TRIGGER ACTIVE
            </span>
          )}
          {latest && (
            <span className="text-[10px] text-insu-muted">{timeAgo(latest.read_at)}</span>
          )}
        </div>
      </div>

      {/* Pulse bar */}
      <div className="relative mb-3 h-3 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-700', barColor,
            !inWindow && 'opacity-30')}
          style={{ width: displayIndex !== null ? `${displayIndex}%` : '0%' }}
        />
        {/* Threshold marker */}
        <div
          className="absolute inset-y-0 w-px bg-white/40"
          style={{ left: `${threshold}%` }}
        />
      </div>

      <div className="mb-3 flex items-center justify-between text-[10px]">
        <span className="text-insu-muted">0</span>
        <span className={cn('font-semibold tabular-nums', isTriggered ? 'text-red-400' : 'text-insu-text')}>
          {displayIndex !== null
            ? inWindow ? `${displayIndex} / 100` : `${displayIndex} (fuera de ventana)`
            : '—'}
        </span>
        <span className="text-insu-muted">100</span>
      </div>

      {/* Sparkline */}
      {sparkValues.length > 0 && (
        <div className="relative flex h-8 items-end gap-0.5 overflow-hidden">
          {/* Threshold dashed line */}
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-insu-accent/40"
            style={{ bottom: `${(threshold / sparkMax) * 100}%` }}
          />
          {sparkValues.map((val, i) => {
            const heightPct = sparkMax > 0 ? Math.max(4, (val / sparkMax) * 100) : 4
            const triggered = val > threshold
            return (
              <div
                key={i}
                className={cn(
                  'flex-1 rounded-sm transition-all',
                  triggered ? 'bg-red-500/60' : 'bg-insu-accent/30',
                )}
                style={{ height: `${heightPct}%` }}
              />
            )
          })}
        </div>
      )}

      {!inWindow && (
        <p className="mt-2 text-center text-[10px] text-insu-muted">
          {nextWindowLabel(windowStart)}
        </p>
      )}
    </div>
  )
}
