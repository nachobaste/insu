import Link from 'next/link'

interface Props {
  next: string
}

export default function AuthGate({ next }: Props) {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <p className="text-[14px] text-insu-muted">
        Sign in to buy protection or provide capital.
      </p>
      <Link
        href={`/auth/login?next=${encodeURIComponent(next)}`}
        className="rounded-lg bg-insu-accent px-6 py-2.5 text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a]"
      >
        Sign in
      </Link>
    </div>
  )
}
