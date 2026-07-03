import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const upsertContract = vi.fn()
const cancelContract = vi.fn()
vi.mock('@/lib/actions/admin', () => ({
  upsertContract: (...args: unknown[]) => upsertContract(...args),
  cancelContract: (...args: unknown[]) => cancelContract(...args),
}))

import { ContractForm, buildTriggerCondition } from '@/components/admin/contracts/ContractForm'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const categories: any = [{ id: 'cat-1', name: 'Fuel', display_order: 1 }]

// A valid Magna-style fuel contract: both payouts exceed their premiums.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const contract: any = {
  id: 'c-1',
  title: 'Magna Gas Price Spike — CDMX',
  description: 'x',
  category_id: 'cat-1',
  status: 'active',
  trigger_type: 'fuel',
  trigger_condition: { metric: 'price_mxn_per_liter', operator: 'gt', threshold: 25, fuel_type: 'magna', region: 'cdmx' },
  trigger_deadline: '2027-12-31T00:00:00Z',
  is_recurring: false,
  location: { city: 'Mexico City', country: 'MX', lat: 19.43, lng: -99.13 },
  icon_url: null,
  is_featured: false,
  corridor: null,
  coverage_tiers: [
    { name: 'basic', premium_usd: 100, payout_usd: 500, max_capacity_usd: 100000 },
    { name: 'premium', premium_usd: 400, payout_usd: 2000, max_capacity_usd: 100000 },
  ],
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const airQualityContract: any = {
  id: 'c-2',
  title: 'Air Quality Alert — CDMX',
  description: null,
  category_id: 'cat-1',
  status: 'active',
  trigger_type: 'air_quality',
  trigger_condition: { metric: 'aqi_imeca', operator: 'gte', threshold: 0 },
  trigger_deadline: '2027-12-31T00:00:00Z',
  is_recurring: false,
  location: { city: 'Mexico City', country: 'MX', lat: 19.43, lng: -99.13 },
  icon_url: null,
  is_featured: false,
  corridor: null,
  coverage_tiers: [
    { name: 'basic', premium_usd: 100, payout_usd: 500, max_capacity_usd: 100000 },
    { name: 'premium', premium_usd: 400, payout_usd: 2000, max_capacity_usd: 100000 },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  upsertContract.mockResolvedValue('c-1')
})

describe('buildTriggerCondition (air_quality / flood)', () => {
  it('builds an aqi_imeca gte condition for air_quality', () => {
    const c = buildTriggerCondition('air_quality', {
      metric: '', comparator: '>', threshold: '150', unit: '', description: '', fuel_type: '',
    })
    expect(c).toMatchObject({ metric: 'aqi_imeca', operator: 'gte', threshold: 150 })
  })

  it('builds a rain_1h_mm gte condition for flood', () => {
    const c = buildTriggerCondition('flood', {
      metric: '', comparator: '>', threshold: '30', unit: '', description: '', fuel_type: '',
    })
    expect(c).toMatchObject({ metric: 'rain_1h_mm', operator: 'gte', threshold: 30 })
  })
})

describe('ContractForm — tier validation surfaces a real message', () => {
  it('blocks submit with a specific message when a payout does not exceed its premium (the Magna case)', async () => {
    render(<ContractForm categories={categories} contract={contract} />)

    const payout = screen.getByLabelText('Basic payout')
    await userEvent.clear(payout)
    await userEvent.type(payout, '50') // 50 <= premium 100

    await userEvent.click(screen.getByRole('button', { name: /save contract/i }))

    expect(await screen.findByText('Basic payout must exceed its premium')).toBeInTheDocument()
    expect(upsertContract).not.toHaveBeenCalled()
  })

  it('names the offending tier — Pro payout below Pro premium', async () => {
    render(<ContractForm categories={categories} contract={contract} />)

    const payout = screen.getByLabelText('Pro payout')
    await userEvent.clear(payout)
    await userEvent.type(payout, '300') // 300 <= Pro premium 400

    await userEvent.click(screen.getByRole('button', { name: /save contract/i }))

    expect(await screen.findByText('Pro payout must exceed its premium')).toBeInTheDocument()
    expect(upsertContract).not.toHaveBeenCalled()
  })

  it('submits the edit when tier values are valid', async () => {
    render(<ContractForm categories={categories} contract={contract} />)

    await userEvent.click(screen.getByRole('button', { name: /save contract/i }))

    await waitFor(() => expect(upsertContract).toHaveBeenCalledTimes(1))
    expect(upsertContract.mock.calls[0][0]).toMatchObject({ id: 'c-1' })
  })
})

describe('ContractForm — air_quality/flood threshold validation', () => {
  it('blocks submit with "Threshold must be a positive number" when threshold is zero', async () => {
    render(<ContractForm categories={categories} contract={airQualityContract} />)

    await userEvent.click(screen.getByRole('button', { name: /save contract/i }))

    expect(await screen.findByText('Threshold must be a positive number')).toBeInTheDocument()
    expect(upsertContract).not.toHaveBeenCalled()
  })
})
