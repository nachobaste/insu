'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { Contract, OracleReading } from '@/lib/types'

interface ContractWithLatestReading {
  contract: Contract
  latest: OracleReading | null
  readings: OracleReading[]
}

function isWithinWindow(windowStart: string, windowEnd: string): boolean {
  const mexicoCityTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
  const [nowH, nowM] = mexicoCityTime.split(':').map(Number)
  const nowMinutes = nowH * 60 + nowM
  const [startH, startM] = windowStart.substring(0, 5).split(':').map(Number)
  const [endH, endM] = windowEnd.substring(0, 5).split(':').map(Number)
  return nowMinutes >= startH * 60 + startM && nowMinutes < endH * 60 + endM
}

function getStatus(item: ContractWithLatestReading): 'triggered' | 'stale' | 'ok' | 'no-data' | 'off-window' {
  const corridor = item.contract.corridor
  if (corridor && !isWithinWindow(corridor.window_start, corridor.window_end)) {
    return item.latest?.trigger_met ? 'triggered' : 'off-window'
  }
  if (!item.latest) return 'no-data'
  const ageMs = Date.now() - new Date(item.latest.read_at).getTime()
  if (ageMs > 10 * 60 * 1000) return 'stale'
  if (item.latest.trigger_met) return 'triggered'
  return 'ok'
}

function parseValue(reading: OracleReading): string {
  const v = reading.value
  if (typeof v === 'object' && v !== null) {
    const vals = Object.values(v as Record<string, unknown>)
    if (vals.length > 0) {
      const inner = vals[0]
      if (typeof inner === 'object' && inner !== null) {
        const deepVal = Object.values(inner as Record<string, unknown>)[0]
        return String(deepVal ?? '')
      }
      return String(inner ?? '')
    }
  }
  return JSON.stringify(v)
}

function parseThreshold(contract: Contract): string {
  const c = contract.trigger_condition as Record<string, unknown>
  const op = c.operator ?? c.comparator
  if (op && c.threshold !== undefined) {
    return `${op} ${c.threshold}${c.unit ? ` ${c.unit}` : ''}`
  }
  return '—'
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export function OracleMonitor({ items }: { items: ContractWithLatestReading[] }) {
  const [selectedId, setSelectedId] = useState(items[0]?.contract.id ?? null)
  const selected = items.find((i) => i.contract.id === selectedId)

  const maxValue = selected
    ? Math.max(...selected.readings.map((r) => Number(parseValue(r)) || 0), 1)
    : 1

  const threshold = selected
    ? Number((selected.contract.trigger_condition as Record<string, unknown>).threshold) || 0
    : 0

  return (
    <div className="flex h-[calc(100vh-140px)] gap-0 overflow-hidden rounded-lg border border-white/[0.07]">
      {/* Left: contract list */}
      <div className="w-52 flex-shrink-0 overflow-y-auto border-r border-white/[0.07] p-3">
        <p className="mb-2 px-1 text-[10px] uppercase tracking-wider text-insu-muted">
          {items.length} Active Contracts
        </p>
        <div className="flex flex-col gap-2">
          {items.map((item) => {
            const status = getStatus(item)
            return (
              <button
                key={item.contract.id}
                onClick={() => setSelectedId(item.contract.id)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  selectedId === item.contract.id
                    ? 'border-insu-accent bg-insu-accent/[0.05]'
                    : status === 'triggered'
                      ? 'border-red-500/60 hover:border-red-500'
                      : status === 'stale'
                        ? 'border-insu-accent/40 hover:border-insu-accent/60'
                        : 'border-white/[0.07] hover:border-white/20',
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-1">
                  <span className="text-[12px] font-medium text-insu-text truncate">{item.contract.title}</span>
                  <span className={cn(
                    'flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase',
                    status === 'triggered' ? 'bg-red-500 text-white'
                      : status === 'stale' ? 'bg-insu-accent/20 text-insu-accent'
                        : 'bg-white/5 text-insu-muted',
                  )}>
                    {status === 'triggered' ? '⚡ YES'
                      : status === 'stale' ? '⚠ STALE'
                        : status === 'ok' ? 'NO'
                          : status === 'off-window' ? 'OFF WIN'
                            : '—'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                  {[
                    ['Source', item.contract.trigger_type],
                    ['Last read', item.latest ? timeAgo(item.latest.read_at) : '—'],
                    ['Value', item.latest ? parseValue(item.latest) : '—'],
                    ['Threshold', parseThreshold(item.contract)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="text-[9px] uppercase tracking-wider text-insu-muted">{k}</p>
                      <p className={cn('text-[11px]',
                        k === 'Last read' && status === 'stale' ? 'text-insu-accent' : 'text-insu-dim'
                      )}>{v}</p>
                    </div>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Right: detail panel */}
      {selected ? (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-insu-text">{selected.contract.title}</h2>
              <p className="mt-0.5 text-[12px] text-insu-muted">
                {selected.contract.trigger_type} · {parseThreshold(selected.contract)} · Deadline {new Date(selected.contract.trigger_deadline).toLocaleDateString()}
              </p>
            </div>
            {selected.latest && (
              <span className={cn(
                'rounded px-2 py-1 text-[11px] font-bold uppercase tracking-wide',
                selected.latest.trigger_met ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-insu-muted',
              )}>
                {selected.latest.trigger_met ? '⚡ TRIGGERED' : 'NO TRIGGER'}
              </span>
            )}
          </div>

          {/* Bar chart */}
          <div className="mb-5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="relative flex h-16 items-end gap-1">
              {threshold > 0 && (
                <div
                  className="pointer-events-none absolute inset-x-0 border-t border-dashed border-insu-accent/50"
                  style={{ bottom: `${Math.min(100, (threshold / maxValue) * 100)}%` }}
                />
              )}
              {selected.readings.slice(0, 9).reverse().map((r, i) => {
                const val = Number(parseValue(r)) || 0
                const heightPct = maxValue > 0 ? Math.max(2, (val / maxValue) * 100) : 2
                return (
                  <div
                    key={r.id}
                    title={`${val} · ${timeAgo(r.read_at)}`}
                    className={cn('flex-1 rounded-sm', r.trigger_met ? 'bg-red-500' : 'bg-blue-400')}
                    style={{ height: `${heightPct}%`, opacity: 0.4 + (i / 9) * 0.6 }}
                  />
                )
              })}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-insu-muted">
              <span>{selected.readings[Math.min(8, selected.readings.length - 1)] ? timeAgo(selected.readings[Math.min(8, selected.readings.length - 1)].read_at) : ''}</span>
              {threshold > 0 && <span className="text-insu-accent">— threshold {threshold}</span>}
              <span className="text-blue-400">now: {selected.latest ? parseValue(selected.latest) : '—'}</span>
            </div>
          </div>

          {/* Reading log */}
          <p className="mb-2 text-[10px] uppercase tracking-wider text-insu-muted">Reading Log</p>
          <div className="rounded-lg border border-white/[0.07] overflow-hidden">
            <div className="grid grid-cols-[80px_1fr_80px_60px] border-b border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[10px] uppercase tracking-wider text-insu-muted">
              <span>Time</span><span>Raw value</span><span>Parsed</span><span>Trigger</span>
            </div>
            {selected.readings.slice(0, 20).map((r) => (
              <div key={r.id} className="grid grid-cols-[80px_1fr_80px_60px] border-b border-white/[0.04] px-3 py-2 text-[12px] last:border-0">
                <span className="text-insu-muted">{timeAgo(r.read_at)}</span>
                <span className="truncate font-mono text-[11px] text-insu-muted">{JSON.stringify(r.value)}</span>
                <span className="font-mono text-blue-400">{parseValue(r)}</span>
                <span className={r.trigger_met ? 'font-bold text-red-400' : 'text-insu-muted'}>
                  {r.trigger_met ? 'YES' : 'NO'}
                </span>
              </div>
            ))}
            {selected.readings.length === 0 && (
              <p className="px-3 py-4 text-sm text-insu-muted">No readings yet.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-insu-muted">Select a contract to view oracle readings.</p>
        </div>
      )}
    </div>
  )
}
