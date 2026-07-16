// proxy.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // Skip Supabase session refresh if env vars are not configured (e.g. during e2e tests)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.warn('[proxy] Supabase env vars not configured — skipping session refresh')
    return NextResponse.next({ request })
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refreshes the session — do not remove.
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isProtected = pathname.startsWith('/dashboard') || pathname.startsWith('/admin')
  if (isProtected && !user) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  // Engagement heartbeat: stamp last_seen_at and count distinct active days for
  // the signed-in user. Throttled to once per calendar day via a cookie so it is
  // one DB write per user per day, not per navigation. Best-effort — never blocks
  // the request. Sessions are long-lived, so this (not sign-ins) is what tells us
  // whether a tester keeps coming back.
  if (user) {
    const today = new Date().toISOString().slice(0, 10)
    if (request.cookies.get('insu_seen')?.value !== today) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.rpc as any)('touch_last_seen', { p_user_id: user.id })
        // Set the throttle cookie only after a successful stamp, so a failed
        // write is retried on the next navigation rather than skipped for the day.
        supabaseResponse.cookies.set('insu_seen', today, {
          httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24,
        })
      } catch {
        // Best-effort engagement metric — a transient DB/network error must
        // never break navigation. Swallow and move on.
      }
    }
  }

  // Optional IP allowlist for /admin — set ADMIN_IP_ALLOWLIST=ip1,ip2 in env to enable
  if (pathname.startsWith('/admin') && user) {
    const allowlist = (process.env.ADMIN_IP_ALLOWLIST ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    if (allowlist.length > 0) {
      const realIp = request.headers.get('x-real-ip')
      const forwarded = request.headers.get('x-forwarded-for')
      const forwardedEntries = forwarded ? forwarded.split(',').map(s => s.trim()).filter(Boolean) : []
      const ip = realIp ?? forwardedEntries[forwardedEntries.length - 1] ?? ''
      if (!allowlist.includes(ip)) {
        return new NextResponse('Access denied', { status: 403 })
      }
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|monitoring|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
