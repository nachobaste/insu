import Link from 'next/link'

export default function AddContractCard() {
  return (
    <Link href="/submit" className="group block">
      <div className="flex min-h-[190px] cursor-pointer flex-col items-center justify-center gap-2.5 rounded-card border border-dashed border-white/10 bg-transparent transition-all hover:border-insu-accent/30 hover:bg-insu-accent/[0.03]">
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-white/15 text-lg text-insu-muted transition-all group-hover:border-insu-accent group-hover:text-insu-accent">
          +
        </div>
        <p className="text-center text-[13px] font-semibold tracking-wide text-insu-muted group-hover:text-insu-dim">
          Submit your
          <br />
          own program
        </p>
      </div>
    </Link>
  )
}
