import { TrafficPulseBar } from './TrafficPulseBar'
import { TrafficPulseBarRefresher } from './TrafficPulseBarRefresher'
import { CorridorMap } from './CorridorMap'
import type { Corridor, OracleReading } from '@/lib/types'

interface Props {
  corridor: Corridor
  readings: OracleReading[]
  triggerCondition: Record<string, unknown>
}

/**
 * Live-traffic evidence for a corridor contract: the pulse bar and map shown
 * side by side on desktop (stacked on narrow screens), plus the 10-min refresher.
 */
export function CorridorEvidence({ corridor, readings, triggerCondition }: Props) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.3fr]">
        <TrafficPulseBar
          readings={readings}
          threshold={Number(triggerCondition.threshold ?? 50)}
          windowStart={corridor.window_start}
          windowEnd={corridor.window_end}
          triggerDescription={String(triggerCondition.description ?? '')}
        />
        <CorridorMap
          originLat={corridor.origin_lat}
          originLng={corridor.origin_lng}
          destLat={corridor.dest_lat}
          destLng={corridor.dest_lng}
          corridorName={corridor.name}
          pathPolyline={corridor.path_polyline}
        />
      </div>
      <TrafficPulseBarRefresher />
    </div>
  )
}
