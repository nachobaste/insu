'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Mode = 'loading' | 'enroll' | 'verify' | 'error'

export function AdminMfaGate({ onVerified }: { onVerified: () => void }) {
  const [mode, setMode] = useState<Mode>('loading')
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  // Resolve which flow we need: verify an existing factor, or enrol a new one.
  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!supabase) {
        setMode('error')
        setError('Authentication is not configured.')
        return
      }

      const { data, error: listErr } = await supabase.auth.mfa.listFactors()
      if (cancelled) return
      if (listErr) {
        setMode('error')
        setError(listErr.message)
        return
      }

      // listFactors() only returns verified factors under `totp`; any present
      // means MFA is already set up and we just need a per-session challenge.
      const verified = data?.totp?.[0]
      if (verified) {
        setFactorId(verified.id)
        setMode('verify')
        return
      }

      // No verified factor — enrol a fresh one. Remove any half-finished
      // (unverified) factors first so friendly names don't collide and stale
      // enrolments don't accumulate. Unverified factors only appear in `all`.
      const stale = (data?.all ?? []).filter(f => f.factor_type === 'totp' && f.status === 'unverified')
      for (const f of stale) {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      if (cancelled) return

      const { data: enrollData, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `admin-${Date.now()}`,
      })
      if (cancelled) return
      if (enrollErr || !enrollData) {
        setMode('error')
        setError(enrollErr?.message ?? 'Failed to start MFA enrollment.')
        return
      }

      setFactorId(enrollData.id)
      setQrCode(enrollData.totp.qr_code)
      setSecret(enrollData.totp.secret)
      setMode('enroll')
    }

    init()
    return () => { cancelled = true }
  }, [supabase])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase || !factorId) return
    setLoading(true)
    setError(null)
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
      if (challengeError || !challenge) {
        setError(challengeError?.message ?? 'Failed to start MFA challenge')
        return
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
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
        <h1 className="text-xl font-semibold mb-2">
          {mode === 'enroll' ? 'Set up admin MFA' : 'Admin MFA required'}
        </h1>

        {mode === 'loading' && (
          <p className="text-sm text-gray-500">Checking your security settings…</p>
        )}

        {mode === 'error' && (
          <p className="text-red-600 text-sm">{error ?? 'Something went wrong.'}</p>
        )}

        {(mode === 'enroll' || mode === 'verify') && (
          <>
            {mode === 'enroll' ? (
              <div className="mb-6">
                <p className="text-sm text-gray-500 mb-4">
                  Scan this QR code with your authenticator app (Google Authenticator, 1Password,
                  Authy…), then enter the 6-digit code to activate.
                </p>
                {qrCode && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrCode} alt="Scan this QR code with your authenticator app" className="mx-auto mb-3 h-44 w-44" />
                )}
                {secret && (
                  <p className="text-xs text-gray-400 text-center break-all">
                    Can&apos;t scan? Enter this key manually:<br />
                    <span className="font-mono text-gray-600">{secret}</span>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500 mb-6">
                Enter your authenticator app code to access the admin panel.
              </p>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
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
                {loading ? 'Verifying…' : mode === 'enroll' ? 'Verify & activate' : 'Verify'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
