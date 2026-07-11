import type { Metadata } from 'next'
import Header from '@/components/layout/Header'

export const metadata: Metadata = {
  title: 'Terms of Service — Insu',
  description: 'Terms of Service for the Insu parametric event-protection marketplace.',
}

const SECTIONS = [
  {
    title: '1. What Insu is',
    body: [
      'Insu is a technology platform that operates a marketplace for parametric event contracts. A parametric contract pays a fixed, predetermined amount when an objective, publicly verifiable data condition (a "trigger") is met — for example, rainfall above a threshold, traffic congestion above a threshold, or the cancellation of a named event.',
      'Contract triggers are evaluated automatically against independent data sources. No person at Insu decides whether a contract pays; the data does.',
    ],
  },
  {
    title: '2. Insu is not an insurance company',
    body: [
      'Insu contracts are not insurance policies, and Insu is not an insurance company, insurance agent, or insurance broker. Insu is not licensed, authorized, or supervised as an insurer in any jurisdiction.',
      'Payments under an Insu contract are fixed amounts determined solely by the trigger condition. They are not adjusted to, conditioned on, or intended as indemnification of any actual loss you may suffer. You do not need to demonstrate, document, or quantify a loss to receive a payment, and a payment may be more or less than any loss you actually experience.',
      'If you need indemnity coverage for a specific loss — such as property damage, medical costs, or liability — you should obtain an insurance policy from a licensed insurer.',
    ],
  },
  {
    title: '3. How contracts settle',
    body: [
      'Each contract specifies its trigger condition, the data sources used to evaluate it, the evaluation window, and the payment amount before you purchase. Trigger evaluation is binary: the condition is either met or it is not, based on the referenced data sources.',
      'The readings of the referenced data sources are final for the purposes of settlement, even if other sources report different values. If a data source becomes permanently unavailable before settlement, Insu may substitute a comparable source or cancel the contract and refund open positions.',
    ],
  },
  {
    title: '4. Buying protection',
    body: [
      'When you buy protection, you pay a fixed price shown to you before purchase. Prices are set algorithmically and may change over time as conditions change; the price you pay is locked at purchase.',
      'You should only purchase protection for events to which you have genuine exposure — for example, a commute you actually make, an event you actually attend, or a business actually affected by the triggering condition. Insu contracts are risk-management tools, not a means of speculation or entertainment.',
    ],
  },
  {
    title: '5. Providing capital',
    body: [
      'Capital providers deposit funds that back protection purchased by other users, and earn fee income when triggers do not fire. Deposited capital is at risk: if a trigger fires, some or all of your deposit is used to fund payments to protection holders.',
      'Provider positions are not bank deposits, are not insured or guaranteed by any government agency or by Insu, and are not securities offered to the public. Expected fee income shown in the product is an estimate, not a promise. Do not deposit funds you cannot afford to lose.',
    ],
  },
  {
    title: '6. Eligibility',
    body: [
      'You must be at least 18 years old and legally capable of entering into binding contracts to use Insu. You are responsible for ensuring that your use of Insu is lawful in your jurisdiction.',
    ],
  },
  {
    title: '7. No advice',
    body: [
      'Nothing on Insu constitutes insurance, financial, investment, legal, or tax advice. Information about triggers, probabilities, prices, and expected fees is provided for transparency and does not constitute a recommendation to buy protection or provide capital.',
    ],
  },
  {
    title: '8. Changes to these terms',
    body: [
      'We may update these terms from time to time. Material changes will be announced in the product. Continued use of Insu after a change takes effect constitutes acceptance of the updated terms.',
    ],
  },
]

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-bg">
      <Header />
      <main className="mx-auto max-w-[760px] px-6 py-16">
        <p className="mb-3 font-mono text-[12px] font-semibold uppercase tracking-[0.2em] text-insu-accent">
          Legal
        </p>
        <h1 className="mb-4 font-display text-[clamp(40px,6vw,64px)] leading-tight tracking-[1px] text-insu-text">
          Terms of Service
        </h1>
        <p className="mb-12 text-[13px] text-insu-dim">Last updated: July 10, 2026</p>

        <div className="space-y-10">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="mb-3 text-[17px] font-semibold text-insu-text">{section.title}</h2>
              <div className="space-y-3">
                {section.body.map((paragraph, i) => (
                  <p key={i} className="text-[14px] leading-relaxed text-insu-muted">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}
