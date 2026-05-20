import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import SearchInput from './SearchInput'

export default async function Header() {
  let userId: string | null = null
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
  } catch {
    // Supabase not configured — render unauthenticated header
  }

  return (
    <header className="sticky top-0 z-50 flex h-[60px] items-center gap-5 border-b border-white/[0.07] bg-bg/85 px-8 backdrop-blur-xl">
      {/* Logo */}
      <Link href="/" className="flex flex-shrink-0 items-center gap-2.5">
        <svg width="44" height="26" viewBox="0 0 44 26" fill="none" aria-hidden>
          {/* House/building shape — left */}
          <polygon points="0,26 0,13 11,1 22,13 22,26" fill="#e8edf5" />
          {/* Parallelogram — right */}
          <polygon points="26,26 33,1 44,1 44,26" fill="#f5a623" />
        </svg>
        <span className="font-display text-[26px] tracking-[4px] text-insu-text">
          INSU
        </span>
        <div className="mx-1 h-5 w-px bg-white/[0.07]" />
        <span className="text-[10px] font-medium uppercase leading-tight tracking-wide text-insu-muted">
          Everyday Risk,
          <br />
          Instantly Covered
        </span>
      </Link>

      {/* Search */}
      <div className="flex max-w-[440px] flex-1 items-center gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.04] px-3.5 py-2.5 transition-colors focus-within:border-insu-accent/30 focus-within:bg-insu-accent/[0.03]">
        <SearchInput />
      </div>

      <div className="flex-1" />

      {/* Nav links */}
      <Link
        href="/how-it-works"
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-insu-dim transition-colors hover:bg-white/[0.05] hover:text-insu-text"
      >
        How it works
      </Link>

      {userId ? (
        <Link
          href="/dashboard"
          className="rounded-lg border border-white/[0.07] px-4 py-1.5 text-[13px] font-semibold text-insu-dim transition-colors hover:border-white/15 hover:text-insu-text"
        >
          Portfolio
        </Link>
      ) : (
        <>
          <Link
            href="/auth/login"
            className="rounded-lg border border-white/[0.07] px-4 py-1.5 text-[13px] font-semibold text-insu-dim transition-colors hover:border-white/15 hover:text-insu-text"
          >
            Log In
          </Link>
          <Link
            href="/auth/signup"
            className="rounded-lg bg-insu-accent px-4 py-1.5 text-[13px] font-bold text-bg transition-all hover:-translate-y-px hover:bg-[#f7b84a] hover:shadow-[0_4px_16px_rgba(245,166,35,0.3)]"
          >
            Sign Up
          </Link>
        </>
      )}
    </header>
  )
}
