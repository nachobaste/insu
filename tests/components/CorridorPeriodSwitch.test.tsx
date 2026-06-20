import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { CorridorPeriodSwitch } from '@/components/markets/CorridorPeriodSwitch'

const options = [
  { period: 'morning' as const, slug: 'm-slug', windowStart: '07:00:00' },
  { period: 'evening' as const, slug: 'e-slug', windowStart: '17:00:00' },
]

describe('CorridorPeriodSwitch (controlled)', () => {
  it('marks the active period and fires onSelect when another is clicked', async () => {
    const onSelect = vi.fn()
    render(<CorridorPeriodSwitch active="morning" options={options} onSelect={onSelect} />)

    expect(screen.getByRole('button', { name: /morning/i })).toHaveAttribute('aria-current', 'true')

    await userEvent.click(screen.getByRole('button', { name: /evening/i }))
    expect(onSelect).toHaveBeenCalledWith('evening')
  })

  it('renders nothing when there are fewer than two options', () => {
    const { container } = render(
      <CorridorPeriodSwitch active="morning" options={[options[0]]} onSelect={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
