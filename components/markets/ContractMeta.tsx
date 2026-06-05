import { formatVolume } from '@/lib/utils'
import type { ContractWithTiers } from '@/lib/types'

interface Props {
  contract: ContractWithTiers
}

const TRIGGER_LABELS: Record<string, string> = {
  weather: 'Weather',
  urban:   'Urban event',
  event:   'Event cancellation',
  manual:  'Manual',
}

export default function ContractMeta({ contract }: Props) {
  const deadline = contract.trigger_deadline
    ? new Date(contract.trigger_deadline).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    : '—'
  const condition = contract.trigger_condition as Record<string, unknown>
  const conditionText = (condition.description as string) ?? JSON.stringify(condition)
  const { city, country } = contract.location

  return (
    <dl className="space-y-3 rounded-card border border-white/[0.07] bg-bg-card p-5 text-[13px]">
      {[
        ['Trigger type',  TRIGGER_LABELS[contract.trigger_type] ?? contract.trigger_type],
        ['Condition',     conditionText],
        ['Deadline',      deadline],
        ['Location',      `${city}, ${country}`],
        ['Total volume',  formatVolume(contract.total_volume_usd)],
      ].map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <dt className="text-insu-muted">{label}</dt>
          <dd className="text-right font-medium text-insu-text">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
