import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import OracleConditions from '@/components/markets/OracleConditions'
import type { LatestOracleReading } from '@/lib/types'
import type { TriggerCondition } from '@/lib/oracle/trigger'

const gteCondition: TriggerCondition = { metric: 'temp_c', threshold: 35, operator: 'gte' }
const lteCondition: TriggerCondition = { metric: 'temp_c', threshold: 20, operator: 'lte' }

function makeReading(overrides: Partial<LatestOracleReading> = {}): LatestOracleReading {
  return {
    value: { temp_c: 28.5 },
    read_at: new Date(Date.now() - 14 * 60000).toISOString(),
    source: 'openweathermap',
    trigger_met: false,
    ...overrides,
  }
}

describe('OracleConditions', () => {
  it('renders metric value and threshold label for gte', () => {
    render(<OracleConditions reading={makeReading()} triggerCondition={gteCondition} oracleMultiplier={1.34} />)
    expect(screen.getByText('28.5')).toBeInTheDocument()
    expect(screen.getByText(/Triggers at ≥ 35/)).toBeInTheDocument()
  })

  it('displays correct proximity % for gte', () => {
    // 28.5 / 35 ≈ 0.814 → 81%
    render(<OracleConditions reading={makeReading()} triggerCondition={gteCondition} oracleMultiplier={1.34} />)
    expect(screen.getByText('81% to trigger')).toBeInTheDocument()
  })

  it('displays correct proximity % for lte', () => {
    // threshold/actual = 20/40 = 0.5 → 50%
    render(
      <OracleConditions
        reading={makeReading({ value: { temp_c: 40 } })}
        triggerCondition={lteCondition}
        oracleMultiplier={0.7}
      />,
    )
    expect(screen.getByText('50% to trigger')).toBeInTheDocument()
  })

  it('shows "Premium elevated" and impact for multiplier 1.34', () => {
    // 28.5 / 35 = 81% → elevated state
    render(<OracleConditions reading={makeReading()} triggerCondition={gteCondition} oracleMultiplier={1.34} />)
    expect(screen.getByText('Premium elevated')).toBeInTheDocument()
    expect(screen.getByText('+34% vs baseline')).toBeInTheDocument()
  })

  it('shows "Premium discounted" and impact for multiplier 0.7', () => {
    // 9.8 / 35 = 28% → low state
    render(
      <OracleConditions
        reading={makeReading({ value: { temp_c: 9.8 } })}
        triggerCondition={gteCondition}
        oracleMultiplier={0.7}
      />,
    )
    expect(screen.getByText('Premium discounted')).toBeInTheDocument()
    expect(screen.getByText('-30% vs baseline')).toBeInTheDocument()
  })

  it('hides price impact line when oracleMultiplier === 1.0', () => {
    render(<OracleConditions reading={makeReading()} triggerCondition={gteCondition} oracleMultiplier={1.0} />)
    expect(screen.queryByText(/vs baseline/)).not.toBeInTheDocument()
  })

  it('shows trigger-met state when trigger_met is true', () => {
    render(
      <OracleConditions
        reading={makeReading({ trigger_met: true })}
        triggerCondition={gteCondition}
        oracleMultiplier={3.0}
      />,
    )
    expect(screen.getByText('⚡ Trigger threshold crossed')).toBeInTheDocument()
    expect(screen.getByText('Premium at maximum')).toBeInTheDocument()
  })

  it('returns null when metric key missing from reading value', () => {
    const { container } = render(
      <OracleConditions
        reading={makeReading({ value: {} })}
        triggerCondition={gteCondition}
        oracleMultiplier={1.0}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('applies °C unit label for temp_c metric', () => {
    render(<OracleConditions reading={makeReading()} triggerCondition={gteCondition} oracleMultiplier={1.0} />)
    expect(screen.getByText('°C')).toBeInTheDocument()
  })

  it('shows trigger-met state when proximity >= 1.0', () => {
    // actual=35 / threshold=35 → proximity=1.0 → met
    render(
      <OracleConditions
        reading={makeReading({ value: { temp_c: 35 }, trigger_met: false })}
        triggerCondition={gteCondition}
        oracleMultiplier={3.0}
      />,
    )
    expect(screen.getByText('⚡ Trigger threshold crossed')).toBeInTheDocument()
    expect(screen.getByText('Premium at maximum')).toBeInTheDocument()
  })
})
