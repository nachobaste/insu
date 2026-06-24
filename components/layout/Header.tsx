import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import SearchInput from './SearchInput'
import LogoutButton from './LogoutButton'
import MobileMenu from './MobileMenu'
import NotificationBell from './NotificationBell'
import { getUnreadCount } from '@/lib/actions/notifications'

export default async function Header() {
  let userId: string | null = null
  let isAdmin = false
  let unread = 0
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
    if (userId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single()
      isAdmin = (profile as { role: string } | null)?.role === 'admin'
      unread = await getUnreadCount()
    }
  } catch {
    // Supabase not configured — render unauthenticated header
  }

  return (
    <header className="sticky top-0 z-50 flex h-[60px] items-center gap-3 border-b border-white/[0.07] bg-bg/85 px-4 backdrop-blur-xl sm:gap-5 sm:px-8">
      {/* Logo */}
      <Link href="/" className="flex flex-shrink-0 items-center gap-2.5">
        <svg width="48" height="18" viewBox="0 62 404 152" fill="none" aria-hidden className="h-[18px] w-[40px] sm:w-[48px]">
          <polygon points="0,210 0,122 112,66 212,122 212,210" fill="#e8edf5" />
          <polygon points="228,210 270,66 400,66 358,210" fill="#f5a623" />
        </svg>
        <span className="font-display text-[22px] tracking-[4px] text-insu-text sm:text-[26px]">
          INSU
        </span>
        <div className="mx-1 hidden h-5 w-px bg-white/[0.07] lg:block" />
        <span className="hidden text-[11px] font-medium uppercase leading-tight tracking-wide text-insu-muted lg:block">
          Everyday Risk,
          <br />
          Instantly Covered
        </span>
      </Link>

      {/* Search */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.04] px-3 py-2.5 transition-colors focus-within:border-insu-accent/30 focus-within:bg-insu-accent/[0.03] sm:max-w-[440px] sm:px-3.5">
        <SearchInput />
      </div>

      <div className="hidden flex-1 sm:block" />

      {/* Nav links */}
      <Link
        href="/how-it-works"
        className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-insu-dim transition-colors hover:bg-white/[0.05] hover:text-insu-text sm:flex"
      >
        How it works
      </Link>

      {userId && (
        <div className="flex-shrink-0">
          <NotificationBell initialUnread={unread} />
        </div>
      )}

      {/* Auth / nav buttons — desktop only; phones use the menu below */}
      <div className="hidden items-center gap-3 sm:flex">
        {userId ? (
          <>
            {isAdmin && (
              <Link
                href="/admin"
                className="rounded-lg border border-insu-accent/30 px-3 py-1.5 sm:px-4 text-[13px] font-semibold text-insu-accent transition-colors hover:border-insu-accent/60 hover:bg-insu-accent/5"
              >
                Admin
              </Link>
            )}
            <Link
              href="/dashboard"
              className="rounded-lg border border-white/[0.07] px-3 py-1.5 sm:px-4 text-[13px] font-semibold text-insu-dim transition-colors hover:border-white/15 hover:text-insu-text"
            >
              Portfolio
            </Link>
            <Link
              href="/profile"
              className="rounded-lg border border-white/[0.07] px-3 py-1.5 sm:px-4 text-[13px] font-semibold text-insu-dim transition-colors hover:border-white/15 hover:text-insu-text"
            >
              Profile
            </Link>
            <LogoutButton />
          </>
        ) : (
          <>
            <Link
              href="/auth/login"
              className="rounded-lg border border-white/[0.07] px-3 py-1.5 sm:px-4 text-[13px] font-semibold text-insu-dim transition-colors hover:border-white/15 hover:text-insu-text"
            >
              Log In
            </Link>
            <Link
              href="/auth/signup"
              className="rounded-lg bg-insu-accent px-3 py-1.5 sm:px-4 text-[13px] font-bold text-bg transition-all hover:-translate-y-px hover:bg-[#f7b84a] hover:shadow-[0_4px_16px_rgba(245,166,35,0.3)]"
            >
              Sign Up
            </Link>
          </>
        )}
      </div>

      {/* Mobile hamburger menu (phones only) */}
      <MobileMenu userId={userId} isAdmin={isAdmin} />
    </header>
  )
}
