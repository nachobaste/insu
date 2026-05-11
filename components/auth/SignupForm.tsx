'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function SignupForm() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <div className="mx-auto w-full max-w-sm text-center">
        <div className="mb-4 text-4xl" aria-hidden="true">✉️</div>
        <h2 className="mb-2 font-display text-[28px] tracking-[2px] text-insu-text">
          Check your email
        </h2>
        <p className="text-[13px] text-insu-muted">
          We sent a confirmation link to{' '}
          <span className="text-insu-text">{email}</span>
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="mb-1 font-display text-[36px] tracking-[3px] text-insu-text">
        Get protected
      </h1>
      <p className="mb-8 text-[13px] text-insu-muted">
        Already have an account?{' '}
        <Link href="/auth/login" className="text-insu-accent hover:underline">
          Log in
        </Link>
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="signup-name" className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-insu-muted">
            Full Name
          </label>
          <input
            id="signup-name"
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-lg border border-white/[0.07] bg-bg-card px-4 py-2.5 text-[14px] text-insu-text outline-none transition-colors focus:border-insu-accent/40 focus:bg-insu-accent/[0.02]"
          />
        </div>

        <div>
          <label htmlFor="signup-email" className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-insu-muted">
            Email
          </label>
          <input
            id="signup-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-white/[0.07] bg-bg-card px-4 py-2.5 text-[14px] text-insu-text outline-none transition-colors focus:border-insu-accent/40 focus:bg-insu-accent/[0.02]"
          />
        </div>

        <div>
          <label htmlFor="signup-password" className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-insu-muted">
            Password
          </label>
          <input
            id="signup-password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-white/[0.07] bg-bg-card px-4 py-2.5 text-[14px] text-insu-text outline-none transition-colors focus:border-insu-accent/40 focus:bg-insu-accent/[0.02]"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-4 py-2.5 text-[13px] text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-insu-accent py-2.5 text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a] disabled:opacity-50"
        >
          {loading ? 'Creating account…' : 'Sign Up'}
        </button>
      </form>
    </div>
  )
}
