import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import SubmitForm from '@/components/submit/SubmitForm'
import type { Category } from '@/lib/types'

export default async function SubmitPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?next=/submit')

  const { data: categories } = await supabase
    .from('categories')
    .select('*')
    .order('display_order')

  return (
    <div className="min-h-screen bg-bg">
      <Header />
      <main className="mx-auto max-w-[680px] px-6 py-14">
        {/* Header */}
        <div className="mb-10">
          <p className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.2em] text-insu-accent">
            Submit your own program
          </p>
          <h1 className="mb-3 font-display text-[40px] leading-tight tracking-wide sm:text-[52px] text-insu-text">
            Pitch a protection
          </h1>
          <p className="text-[14px] leading-relaxed text-insu-muted">
            See an event that deserves automatic payout protection? Tell us about it. Our team will review your pitch, set the oracle trigger, price the tiers, and launch it on the marketplace. No technical knowledge required.
          </p>
        </div>

        {/* How it works — 3 quick steps */}
        <div className="mb-10 grid grid-cols-3 gap-3">
          {[
            { n: '1', label: 'You pitch the event' },
            { n: '2', label: 'We set up the oracle' },
            { n: '3', label: 'It goes live on the marketplace' },
          ].map((step) => (
            <div key={step.n} className="rounded-lg border border-white/[0.07] bg-bg-card p-4 text-center">
              <div className="mb-2 font-display text-[28px] text-insu-accent">{step.n}</div>
              <p className="text-[13px] leading-snug text-insu-muted">{step.label}</p>
            </div>
          ))}
        </div>

        {/* Form */}
        <div className="rounded-[14px] border border-white/[0.07] bg-bg-card p-5 sm:p-8">
          <SubmitForm categories={(categories ?? []) as Category[]} />
        </div>
      </main>
    </div>
  )
}
