'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setLoading(false)
    router.push('/')
    router.refresh()
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="mb-1 font-display text-[36px] tracking-[3px] text-insu-text">
        Welcome back
      </h1>
      <p className="mb-8 text-[13px] text-insu-muted">
        Don&apos;t have an account?{' '}
        <Link href="/auth/signup" className="text-insu-accent hover:underline">
          Sign up
        </Link>
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-insu-muted">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-white/[0.07] bg-bg-card px-4 py-2.5 text-[14px] text-insu-text outline-none transition-colors focus:border-insu-accent/40 focus:bg-insu-accent/[0.02]"
          />
        </div>

        <div>
          <label htmlFor="login-password" className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-insu-muted">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            required
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
          {loading ? 'Signing in…' : 'Log In'}
        </button>
      </form>
    </div>
  )
}
