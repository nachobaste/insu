import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-white/[0.06] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1320px]">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-[640px]">
            <p className="text-[12px] leading-relaxed text-insu-muted">
              Insu is a technology platform offering parametric event contracts. Insu is not an
              insurance company, and its contracts are not insurance policies. Contracts pay a
              fixed amount based on objective, publicly verifiable data triggers and are not tied
              to indemnification of any actual loss. See our{' '}
              <Link href="/terms" className="underline decoration-white/20 underline-offset-2 transition-colors hover:text-insu-text">
                Terms of Service
              </Link>{' '}
              for details.
            </p>
          </div>
          <nav className="flex gap-6 text-[12px] font-medium text-insu-muted">
            <Link href="/how-it-works" className="transition-colors hover:text-insu-text">
              How it works
            </Link>
            <Link href="/terms" className="transition-colors hover:text-insu-text">
              Terms
            </Link>
          </nav>
        </div>
        <p className="mt-6 text-[11px] text-insu-dim">
          © {new Date().getFullYear()} Insu. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
