import { formatVolume } from '@/lib/utils'

interface Stats {
  totalVolumeUsd: number
  activeContracts: number
  protectionsSold: number
  avgPayoutMinutes: number
}

interface Props {
  stats: Stats
}

const items = [
  {
    key: 'totalVolumeUsd' as const,
    label: 'Total Volume',
    format: (v: number) => formatVolume(v),
    className: 'text-insu-accent',
  },
  {
    key: 'activeContracts' as const,
    label: 'Active Contracts',
    format: (v: number) => v.toLocaleString(),
    className: '',
  },
  {
    key: 'protectionsSold' as const,
    label: 'Protections Sold',
    format: (v: number) => v.toLocaleString(),
    className: '',
  },
  {
    key: 'avgPayoutMinutes' as const,
    label: 'Avg Payout Time',
    format: (v: number) => `${v} min`,
    className: '',
  },
]

export default function StatsBar({ stats }: Props) {
  return (
    <div className="relative mb-7 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-white/[0.07] bg-white/[0.07] lg:grid-cols-5">
      {/* Amber left accent */}
      <div className="absolute bottom-0 left-0 top-0 w-[3px] bg-insu-accent" />

      {items.map((item) => (
        <div
          key={item.key}
          className="flex flex-col items-center bg-bg-card px-4 py-4"
        >
          <span className={`font-mono text-[20px] font-bold tracking-tight ${item.className}`}>
            {item.format(stats[item.key])}
          </span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-insu-muted">
            {item.label}
          </span>
        </div>
      ))}

      {/* 100% auto-settled */}
      <div className="flex flex-col items-center bg-bg-card px-4 py-4 col-span-2 lg:col-span-1">
        <span className="font-mono text-[20px] font-bold tracking-tight text-insu-green">
          100%
        </span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-insu-muted">
          Auto-Settled
        </span>
      </div>
    </div>
  )
}
