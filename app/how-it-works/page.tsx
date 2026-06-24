import Link from 'next/link'
import Header from '@/components/layout/Header'

const STEPS = [
  {
    n: '01',
    title: 'Choose your protection',
    body: 'Browse contracts covering weather events, traffic disruptions, festival cancellations, and more. Each contract has a defined trigger condition and a fixed payout — no ambiguity, no fine print.',
    tag: 'MARKETPLACE',
  },
  {
    n: '02',
    title: 'Pay your premium',
    body: 'Select a Basic or Premium tier and pay instantly via card. Your position is locked before the trigger deadline. The premium funds the liquidity pool that backs your payout.',
    tag: 'PAYMENT',
  },
  {
    n: '03',
    title: 'Oracle monitors the trigger',
    body: 'Our oracle layer polls live data sources — OpenWeatherMap and Tomorrow.io weather feeds, Google Maps traffic, and CRE fuel prices — automatically. No manual input. No human discretion.',
    tag: 'ORACLE',
  },
  {
    n: '04',
    title: 'Trigger fires → payout in minutes',
    body: 'When the condition is met, the contract settles automatically. Funds are released to all qualifying positions without a claim form, adjuster, or waiting period.',
    tag: 'SETTLEMENT',
  },
]

const PROBLEMS = [
  {
    icon: '⏳',
    title: 'Weeks to settle',
    body: 'Traditional insurers average 30–90 days from claim to payout. Insu settles in under 10 minutes.',
  },
  {
    icon: '⚖️',
    title: 'Disputed outcomes',
    body: 'Adjusters interpret policy language differently on every claim. Parametric triggers are binary — they either fire or they don\'t.',
  },
  {
    icon: '📋',
    title: 'Proof of loss',
    body: 'You must document your damage, submit receipts, and argue your case. With Insu, the event data is the proof.',
  },
]

const SIDES = [
  {
    role: 'Hedger',
    color: '#f5a623',
    tagline: 'Buy certainty against disruption',
    description: 'Runners buying marathon rain cover. Vendors protecting their festival weekend. Businesses guarding against traffic-triggered revenue loss. Hedgers pay a fixed premium and receive a fixed payout if the trigger fires — regardless of their actual loss.',
    items: ['Fixed premium, known upfront', 'Payout in minutes, not months', 'No claim forms, no receipts', 'Coverage from $18 USD/event'],
  },
  {
    role: 'Provider',
    color: '#34d399',
    tagline: 'Earn yield on event risk',
    description: 'Capital providers deposit into a liquidity pool and earn the premium income when triggers don\'t fire. Risk is bounded, transparent, and diversified across multiple contracts. Expected return is priced actuarially at each repricing cycle.',
    items: ['Earn premium yield on capital', 'Risk parameters known before deposit', 'Repriced every 6 hours', 'Withdraw after contract settles'],
  },
]

const STATS = [
  { value: '$103K+', label: 'Total volume protected' },
  { value: '< 10 min', label: 'Average payout time' },
  { value: '6', label: 'Live contracts' },
  { value: '4', label: 'Oracle data sources' },
]

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-bg">
      <Header />

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-white/[0.06] px-8 pb-24 pt-20">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-insu-accent/[0.05] blur-[120px]" />

        <div className="relative mx-auto max-w-[1100px]">
          <p className="mb-4 font-mono text-[12px] font-semibold uppercase tracking-[0.2em] text-insu-accent">
            How Insu works
          </p>
          <h1 className="font-display text-[clamp(56px,9vw,108px)] leading-[0.92] tracking-[2px] text-insu-text">
            Insurance that pays
            <br />
            <span className="text-insu-accent">the moment</span>
            <br />
            it happens.
          </h1>
          <p className="mt-8 max-w-[560px] text-[17px] font-light leading-relaxed text-insu-dim">
            Insu is a parametric event-protection marketplace. Instead of filing a claim and waiting for an adjuster, you buy a contract that pays automatically when a measurable trigger fires. No paperwork. No disputes. Just data.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              href="/"
              className="rounded-lg bg-insu-accent px-6 py-3 text-[14px] font-bold text-bg transition-all hover:-translate-y-px hover:bg-[#f7b84a] hover:shadow-[0_4px_20px_rgba(245,166,35,0.35)]"
            >
              Browse live contracts
            </Link>
            <Link
              href="/auth/signup"
              className="rounded-lg border border-white/[0.1] px-6 py-3 text-[14px] font-semibold text-insu-dim transition-colors hover:border-white/20 hover:text-insu-text"
            >
              Create account
            </Link>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ────────────────────────────────────────────── */}
      <section className="border-b border-white/[0.06] bg-bg-card">
        <div className="mx-auto grid max-w-[1100px] grid-cols-2 divide-x divide-white/[0.06] md:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="px-8 py-6">
              <div className="font-display text-[36px] tracking-wide text-insu-accent">{s.value}</div>
              <div className="mt-0.5 text-[13px] font-medium uppercase tracking-wider text-insu-muted">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS — 4 STEPS ───────────────────────────────── */}
      <section className="border-b border-white/[0.06] px-8 py-20">
        <div className="mx-auto max-w-[1100px]">
          <p className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.2em] text-insu-muted">
            The mechanism
          </p>
          <h2 className="mb-16 font-display text-[clamp(36px,5vw,64px)] leading-tight tracking-[1px] text-insu-text">
            Four steps from risk
            <br />
            <span className="text-insu-accent">to certainty.</span>
          </h2>

          <div className="relative">
            {/* Vertical connector line */}
            <div className="absolute left-[19px] top-6 hidden h-[calc(100%-48px)] w-px bg-gradient-to-b from-insu-accent/40 via-insu-accent/20 to-transparent md:block" />

            <div className="flex flex-col gap-10">
              {STEPS.map((step, i) => (
                <div key={step.n} className="flex gap-8">
                  {/* Step number */}
                  <div className="relative flex-shrink-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-insu-accent/30 bg-bg-card">
                      <span className="font-mono text-[12px] font-bold text-insu-accent">{i + 1}</span>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 rounded-[14px] border border-white/[0.07] bg-bg-card p-7 transition-colors hover:border-white/[0.12]">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-insu-accent/70">
                        {step.tag}
                      </span>
                    </div>
                    <h3 className="mb-2 font-display text-[28px] tracking-wide text-insu-text">{step.title}</h3>
                    <p className="text-[14px] leading-relaxed text-insu-muted">{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── THE PROBLEM ──────────────────────────────────────────── */}
      <section className="border-b border-white/[0.06] px-8 py-20">
        <div className="mx-auto max-w-[1100px]">
          <p className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.2em] text-insu-muted">
            The problem
          </p>
          <h2 className="mb-12 font-display text-[clamp(36px,5vw,64px)] leading-tight tracking-[1px] text-insu-text">
            Traditional insurance fails
            <br />
            <span className="text-insu-muted">when you need it most.</span>
          </h2>
          <div className="grid gap-5 md:grid-cols-3">
            {PROBLEMS.map((p) => (
              <div
                key={p.title}
                className="rounded-[14px] border border-white/[0.07] bg-bg-card p-7 transition-colors hover:border-white/[0.12]"
              >
                <div className="mb-4 text-3xl">{p.icon}</div>
                <h3 className="mb-2 text-[16px] font-semibold text-insu-text">{p.title}</h3>
                <p className="text-[13.5px] leading-relaxed text-insu-muted">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TWO SIDES ────────────────────────────────────────────── */}
      <section className="border-b border-white/[0.06] px-8 py-20">
        <div className="mx-auto max-w-[1100px]">
          <p className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.2em] text-insu-muted">
            Two-sided marketplace
          </p>
          <h2 className="mb-12 font-display text-[clamp(36px,5vw,64px)] leading-tight tracking-[1px] text-insu-text">
            Protection buyers meet
            <br />
            <span className="text-insu-muted">capital providers.</span>
          </h2>

          <div className="grid gap-6 md:grid-cols-2">
            {SIDES.map((side) => (
              <div
                key={side.role}
                className="rounded-[14px] border border-white/[0.07] bg-bg-card p-8 transition-colors hover:border-white/[0.12]"
              >
                <div
                  className="mb-1 font-mono text-[12px] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: side.color }}
                >
                  {side.role}
                </div>
                <h3 className="mb-4 font-display text-[32px] tracking-wide text-insu-text">
                  {side.tagline}
                </h3>
                <p className="mb-6 text-[13.5px] leading-relaxed text-insu-muted">{side.description}</p>
                <ul className="space-y-2.5">
                  {side.items.map((item) => (
                    <li key={item} className="flex items-center gap-2.5">
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: side.color }} />
                      <span className="text-[13px] text-insu-dim">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TECH PIPELINE ────────────────────────────────────────── */}
      <section className="border-b border-white/[0.06] px-8 py-20">
        <div className="mx-auto max-w-[1100px]">
          <p className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.2em] text-insu-muted">
            Under the hood
          </p>
          <h2 className="mb-12 font-display text-[clamp(36px,5vw,64px)] leading-tight tracking-[1px] text-insu-text">
            Automated from data
            <br />
            <span className="text-insu-accent">to settlement.</span>
          </h2>

          {/* Pipeline diagram */}
          <div className="overflow-x-auto">
            <div className="flex min-w-[700px] items-stretch gap-0">
              {[
                {
                  label: 'DATA SOURCES',
                  items: ['OpenWeatherMap', 'Tomorrow.io', 'Google Maps traffic', 'CRE fuel prices'],
                  color: '#94a3b8',
                  bg: 'rgba(148,163,184,0.06)',
                },
                {
                  label: 'ORACLE LAYER',
                  items: ['Polls every 5 min', 'Stores readings', 'Flags threshold breach'],
                  color: '#a78bfa',
                  bg: 'rgba(167,139,250,0.06)',
                },
                {
                  label: 'SETTLEMENT ENGINE',
                  items: ['Evaluates trigger logic', 'Marks contract settled', 'Queues payouts'],
                  color: '#f5a623',
                  bg: 'rgba(245,166,35,0.06)',
                },
                {
                  label: 'PAYOUT',
                  items: ['Stripe transfer', 'All positions paid', '< 10 min end-to-end'],
                  color: '#34d399',
                  bg: 'rgba(52,211,153,0.06)',
                },
              ].map((node, i, arr) => (
                <div key={node.label} className="flex flex-1 items-stretch">
                  <div
                    className="flex flex-1 flex-col rounded-[14px] border border-white/[0.07] p-6"
                    style={{ background: node.bg }}
                  >
                    <div
                      className="mb-4 font-mono text-[11px] font-bold uppercase tracking-[0.18em]"
                      style={{ color: node.color }}
                    >
                      {node.label}
                    </div>
                    <ul className="space-y-2">
                      {node.items.map((item) => (
                        <li key={item} className="text-[12.5px] text-insu-muted">{item}</li>
                      ))}
                    </ul>
                  </div>
                  {i < arr.length - 1 && (
                    <div className="flex flex-shrink-0 items-center px-2">
                      <svg width="20" height="12" viewBox="0 0 20 12" fill="none">
                        <path d="M0 6h16M12 1l6 5-6 5" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8 rounded-[14px] border border-white/[0.07] bg-bg-card px-7 py-5">
            <p className="font-mono text-[13px] leading-relaxed text-insu-muted">
              <span className="text-insu-accent">{'// Repricing'}</span>{' runs on a 6-hour cron cycle using an actuarial formula that accounts for base probability, capacity utilization, and time-to-deadline decay. Premiums adjust automatically — no manual intervention required.'}
            </p>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-8 py-24">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[400px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-insu-accent/[0.06] blur-[100px]" />
        <div className="relative mx-auto max-w-[1100px] text-center">
          <h2 className="mb-4 font-display text-[clamp(40px,6vw,80px)] leading-tight tracking-[1px] text-insu-text">
            Ready to get protected?
          </h2>
          <p className="mx-auto mb-10 max-w-[480px] text-[15px] leading-relaxed text-insu-dim">
            Browse live contracts covering weather, traffic, and events across Mexico. Your first protection takes under 2 minutes to set up.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/"
              className="rounded-lg bg-insu-accent px-8 py-3.5 text-[15px] font-bold text-bg transition-all hover:-translate-y-px hover:bg-[#f7b84a] hover:shadow-[0_6px_24px_rgba(245,166,35,0.4)]"
            >
              Browse protections
            </Link>
            <Link
              href="/auth/signup"
              className="rounded-lg border border-white/[0.1] px-8 py-3.5 text-[15px] font-semibold text-insu-dim transition-colors hover:border-white/20 hover:text-insu-text"
            >
              Create account
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
