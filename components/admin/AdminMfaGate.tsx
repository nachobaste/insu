'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function AdminMfaGate({ onVerified }: { onVerified: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const supabase = createClient()!

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const totpFactor = factors?.totp?.[0]
      if (!totpFactor) {
        setError('No MFA factor enrolled. Contact your administrator to set up TOTP.')
        return
      }

      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: totpFactor.id,
      })
      if (challengeError || !challenge) {
        setError(challengeError?.message ?? 'Failed to start MFA challenge')
        return
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: totpFactor.id,
        challengeId: challenge.id,
        code,
      })
      if (verifyError) {
        setError('Invalid code — try again')
        return
      }

      onVerified()
    } catch {
      setError('An unexpected error occurred — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-2">Admin MFA Required</h1>
        <p className="text-sm text-gray-500 mb-6">
          Enter your authenticator app code to access the admin panel.
        </p>
        <form onSubmit={handleVerify} className="space-y-4">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full border rounded px-3 py-2 text-center text-lg tracking-widest"
            required
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full bg-black text-white py-2 rounded disabled:opacity-50"
          >
            {loading ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      </div>
    </div>
  )
}
