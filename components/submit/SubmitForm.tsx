'use client'

import { useState, useTransition } from 'react'
import { submitProgram } from '@/lib/actions/submit'
import type { Category } from '@/lib/types'

const TRIGGER_TYPES = [
  { value: 'weather', label: 'Weather event', example: 'Heavy rain, extreme heat, flooding…' },
  { value: 'urban', label: 'Traffic / urban disruption', example: 'Congestion, road closures, transit delays…' },
  { value: 'event', label: 'Event cancellation', example: 'Concert, festival, sporting event cancelled…' },
  { value: 'manual', label: 'Other / manual', example: 'Power outage, government closure, force majeure…' },
]

interface Props {
  categories: Category[]
}

export default function SubmitForm({ categories }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [triggerType, setTriggerType] = useState('weather')
  const [triggerDescription, setTriggerDescription] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('Mexico')
  const [eventDate, setEventDate] = useState('')
  const [proposedPayout, setProposedPayout] = useState('')

  const minDate = new Date()
  minDate.setDate(minDate.getDate() + 7)
  const minDateStr = minDate.toISOString().split('T')[0]

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await submitProgram({
          title, description, category_id: categoryId,
          trigger_type: triggerType, trigger_description: triggerDescription,
          location_city: city, location_country: country,
          event_date: eventDate, proposed_payout: proposedPayout,
        })
        setSubmitted(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Submission failed')
      }
    })
  }

  const input = 'w-full rounded-lg border border-white/[0.07] bg-bg px-4 py-2.5 text-[14px] text-insu-text placeholder:text-insu-muted/60 focus:border-insu-accent/40 focus:outline-none transition-colors'
  const label = 'mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-insu-muted'

  if (submitted) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-insu-green/30 bg-insu-green/10 text-3xl">
          ✓
        </div>
        <h2 className="mb-2 font-display text-[36px] tracking-wide text-insu-text">Submission received</h2>
        <p className="mb-1 text-[15px] text-insu-dim">
          <span className="font-semibold text-insu-text">{title}</span> is under review.
        </p>
        <p className="max-w-sm text-[13px] leading-relaxed text-insu-muted">
          Our team will review your pitch, set the technical trigger conditions and pricing, and activate it on the marketplace. We&apos;ll reach out if we have questions.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400">
          {error}
        </p>
      )}

      {/* Name + Category */}
      <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
        <div>
          <label className={label}>Program name</label>
          <input
            className={input}
            placeholder="e.g. Cancún Hurricane Season Cover"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div>
          <label className={label}>Category</label>
          <select className={input + ' cursor-pointer'} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Description */}
      <div>
        <label className={label}>What&apos;s the event?</label>
        <textarea
          className={input}
          rows={3}
          placeholder="Describe the real-world event or situation this program covers. Who needs this protection and why?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>

      {/* Trigger type */}
      <div>
        <label className={label}>Type of trigger</label>
        <div className="grid gap-2 sm:grid-cols-2">
          {TRIGGER_TYPES.map((t) => (
            <label
              key={t.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors ${
                triggerType === t.value
                  ? 'border-insu-accent/40 bg-insu-accent/[0.04]'
                  : 'border-white/[0.07] hover:border-white/[0.12]'
              }`}
            >
              <input
                type="radio"
                name="trigger_type"
                value={t.value}
                checked={triggerType === t.value}
                onChange={() => setTriggerType(t.value)}
                className="mt-0.5 accent-[#f5a623]"
              />
              <div>
                <p className="text-[13px] font-semibold text-insu-text">{t.label}</p>
                <p className="text-[12px] text-insu-muted">{t.example}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Trigger description */}
      <div>
        <label className={label}>What should trigger the payout?</label>
        <textarea
          className={input}
          rows={2}
          placeholder="Describe in plain language what condition must be met. e.g. 'Rainfall exceeds 40mm in 24 hours on the event day'"
          value={triggerDescription}
          onChange={(e) => setTriggerDescription(e.target.value)}
          required
        />
        <p className="mt-1.5 text-[12px] text-insu-muted">
          Our team will translate this into a precise oracle condition.
        </p>
      </div>

      {/* Location + Date */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className={label}>City</label>
          <input
            className={input}
            placeholder="e.g. Guadalajara"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            required
          />
        </div>
        <div>
          <label className={label}>Country</label>
          <input
            className={input}
            placeholder="Mexico"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            required
          />
        </div>
        <div>
          <label className={label}>Event date</label>
          <input
            type="date"
            className={input}
            min={minDateStr}
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            required
          />
        </div>
      </div>

      {/* Proposed payout */}
      <div>
        <label className={label}>Proposed payout amount (USD, optional)</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[14px] text-insu-muted">$</span>
          <input
            type="number"
            min="50"
            step="50"
            className={input + ' pl-8'}
            placeholder="e.g. 500"
            value={proposedPayout}
            onChange={(e) => setProposedPayout(e.target.value)}
          />
        </div>
        <p className="mt-1.5 text-[12px] text-insu-muted">
          Insu sets final pricing actuarially — this is your reference, not a commitment.
        </p>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-lg bg-insu-accent py-3 text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a] hover:shadow-[0_4px_20px_rgba(245,166,35,0.3)] disabled:opacity-50"
      >
        {isPending ? 'Submitting…' : 'Submit program'}
      </button>
    </form>
  )
}
