import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Controllable supabase MFA mock
const mfa = {
  listFactors: vi.fn(),
  unenroll: vi.fn(),
  enroll: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
}
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { mfa } }),
}))

import { AdminMfaGate } from '@/components/admin/AdminMfaGate'

beforeEach(() => {
  vi.clearAllMocks()
  mfa.challenge.mockResolvedValue({ data: { id: 'chal-1' }, error: null })
  mfa.verify.mockResolvedValue({ data: {}, error: null })
  mfa.unenroll.mockResolvedValue({ data: {}, error: null })
})

describe('AdminMfaGate — enroll mode (no factor yet)', () => {
  beforeEach(() => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [] }, error: null })
    mfa.enroll.mockResolvedValue({
      data: { id: 'factor-new', totp: { qr_code: 'data:image/svg+xml,QR', secret: 'SECRET123', uri: 'otpauth://x' } },
      error: null,
    })
  })

  it('enrolls a fresh TOTP factor and shows the QR code + secret', async () => {
    render(<AdminMfaGate onVerified={vi.fn()} />)
    await waitFor(() => expect(mfa.enroll).toHaveBeenCalledWith(expect.objectContaining({ factorType: 'totp' })))
    expect(await screen.findByAltText(/scan/i)).toHaveAttribute('src', 'data:image/svg+xml,QR')
    expect(screen.getByText(/SECRET123/)).toBeInTheDocument()
  })

  it('verifies the entered code against the newly enrolled factor', async () => {
    const onVerified = vi.fn()
    render(<AdminMfaGate onVerified={onVerified} />)
    const input = await screen.findByPlaceholderText(/6-digit code/i)
    await userEvent.type(input, '123456')
    await userEvent.click(screen.getByRole('button', { name: /verify|activate/i }))
    await waitFor(() => {
      expect(mfa.challenge).toHaveBeenCalledWith({ factorId: 'factor-new' })
      expect(mfa.verify).toHaveBeenCalledWith({ factorId: 'factor-new', challengeId: 'chal-1', code: '123456' })
      expect(onVerified).toHaveBeenCalled()
    })
  })

  it('cleans up stale unverified factors before enrolling', async () => {
    // Unverified factors are only surfaced under `all`, never `totp`.
    mfa.listFactors.mockResolvedValue({
      data: { totp: [], all: [{ id: 'stale-1', status: 'unverified', factor_type: 'totp' }] },
      error: null,
    })
    render(<AdminMfaGate onVerified={vi.fn()} />)
    await waitFor(() => expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'stale-1' }))
    expect(mfa.enroll).toHaveBeenCalled()
  })
})

describe('AdminMfaGate — verify mode (factor already enrolled)', () => {
  beforeEach(() => {
    mfa.listFactors.mockResolvedValue({
      data: {
        totp: [{ id: 'factor-existing', status: 'verified', factor_type: 'totp' }],
        all: [{ id: 'factor-existing', status: 'verified', factor_type: 'totp' }],
      },
      error: null,
    })
  })

  it('does not enroll when a verified factor exists', async () => {
    render(<AdminMfaGate onVerified={vi.fn()} />)
    const input = await screen.findByPlaceholderText(/6-digit code/i)
    expect(input).toBeInTheDocument()
    expect(mfa.enroll).not.toHaveBeenCalled()
  })

  it('challenges + verifies the existing factor and calls onVerified', async () => {
    const onVerified = vi.fn()
    render(<AdminMfaGate onVerified={onVerified} />)
    const input = await screen.findByPlaceholderText(/6-digit code/i)
    await userEvent.type(input, '654321')
    await userEvent.click(screen.getByRole('button', { name: /verify/i }))
    await waitFor(() => {
      expect(mfa.challenge).toHaveBeenCalledWith({ factorId: 'factor-existing' })
      expect(onVerified).toHaveBeenCalled()
    })
  })

  it('shows an error on an invalid code and does not call onVerified', async () => {
    mfa.verify.mockResolvedValue({ data: null, error: { message: 'invalid' } })
    const onVerified = vi.fn()
    render(<AdminMfaGate onVerified={onVerified} />)
    const input = await screen.findByPlaceholderText(/6-digit code/i)
    await userEvent.type(input, '000000')
    await userEvent.click(screen.getByRole('button', { name: /verify/i }))
    expect(await screen.findByText(/invalid code/i)).toBeInTheDocument()
    expect(onVerified).not.toHaveBeenCalled()
  })
})
