import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ComingSoonPanel from '@/components/markets/ComingSoonPanel'

const toggleMock = vi.fn()
vi.mock('@/lib/actions/launch-interest', () => ({
  toggleLaunchInterest: (...args: unknown[]) => toggleMock(...args),
}))

describe('ComingSoonPanel', () => {
  it('signed out: shows sign-in link, no notify button', () => {
    render(<ComingSoonPanel contractId="c1" userId={null} initiallyInterested={false} />)
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/auth/login')
    expect(screen.queryByRole('button', { name: /notify me/i })).not.toBeInTheDocument()
  })

  it('signed in: toggles interest via the server action', async () => {
    toggleMock.mockResolvedValueOnce(true)
    render(<ComingSoonPanel contractId="c1" userId="u1" initiallyInterested={false} />)
    await userEvent.click(screen.getByRole('button', { name: /notify me at launch/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /we'll notify you/i })).toBeInTheDocument(),
    )
    expect(toggleMock).toHaveBeenCalledWith('c1')
  })

  it('starts in the interested state when preloaded', () => {
    render(<ComingSoonPanel contractId="c1" userId="u1" initiallyInterested />)
    expect(screen.getByRole('button', { name: /we'll notify you/i })).toBeInTheDocument()
  })
})
