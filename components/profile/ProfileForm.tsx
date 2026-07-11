'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { updateProfile } from '@/lib/actions/profile'
import type { NotificationPrefs } from '@/lib/types'

interface Props {
  email: string
  role: string
  createdAt: string
  fullName: string
  preferredCurrency: 'USD' | 'MXN'
  notificationPrefs: NotificationPrefs
}

const PREF_LABELS: Record<keyof NotificationPrefs, string> = {
  coverage_paid: 'Protection triggered / paid out',
  coverage_expired: 'Protection expired (no payout)',
  protection_purchased: 'Protection purchased',
  provider_settled: 'Provider position settled',
  product_launched: 'Launch of products I asked about',
}

const fieldCls =
  'w-full rounded-lg border border-white/[0.07] bg-bg-card px-4 py-2.5 text-[14px] text-insu-text outline-none transition-colors focus:border-insu-accent/40'
const labelCls = 'mb-1.5 block text-[13px] font-semibold uppercase tracking-wider text-insu-muted'
const cardCls = 'rounded-xl border border-white/[0.07] bg-bg-card/40 p-5'

export default function ProfileForm(props: Props) {
  const [fullName, setFullName] = useState(props.fullName)
  const [currency, setCurrency] = useState<'USD' | 'MXN'>(props.preferredCurrency)
  const [prefs, setPrefs] = useState<NotificationPrefs>(props.notificationPrefs)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMsg, setProfileMsg] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [savingPw, setSavingPw] = useState(false)
  const [pwMsg, setPwMsg] = useState<string | null>(null)

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSavingProfile(true)
    setProfileMsg(null)
    const res = await updateProfile({ full_name: fullName, preferred_currency: currency, notification_prefs: prefs })
    setProfileMsg('error' in res ? res.error : 'Saved.')
    setSavingProfile(false)
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault()
    setSavingPw(true)
    setPwMsg(null)
    const supabase = createClient()
    if (!supabase) {
      setPwMsg('Supabase is not configured.')
      setSavingPw(false)
      return
    }
    const { error } = await supabase.auth.updateUser({ password })
    setPwMsg(error ? error.message : 'Password updated.')
    if (!error) setPassword('')
    setSavingPw(false)
  }

  return (
    <div className="space-y-6">
      {/* Account (read-only) */}
      <section className={cardCls}>
        <h2 className="mb-4 text-[15px] font-semibold text-insu-text">Account</h2>
        <dl className="space-y-2 text-[13px]">
          <div className="flex justify-between"><dt className="text-insu-muted">Email</dt><dd className="text-insu-text">{props.email}</dd></div>
          <div className="flex justify-between"><dt className="text-insu-muted">Role</dt><dd className="text-insu-text capitalize">{props.role}</dd></div>
          <div className="flex justify-between"><dt className="text-insu-muted">Member since</dt><dd className="text-insu-text">{new Date(props.createdAt).toLocaleDateString()}</dd></div>
        </dl>
      </section>

      {/* Editable settings */}
      <form onSubmit={saveProfile} className={cardCls + ' space-y-5'}>
        <h2 className="text-[15px] font-semibold text-insu-text">Settings</h2>

        <div>
          <label htmlFor="full-name" className={labelCls}>Display name</label>
          <input id="full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={fieldCls} />
        </div>

        <div>
          <label htmlFor="currency" className={labelCls}>Preferred currency</label>
          <select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value as 'USD' | 'MXN')} className={fieldCls}>
            <option value="USD">USD</option>
            <option value="MXN">MXN</option>
          </select>
        </div>

        <div>
          <span className={labelCls}>Notifications</span>
          <div className="space-y-2">
            {(Object.keys(PREF_LABELS) as Array<keyof NotificationPrefs>).map((key) => (
              <label key={key} className="flex cursor-pointer items-center gap-2.5 text-[13px] text-insu-dim">
                <input
                  type="checkbox"
                  checked={prefs[key]}
                  onChange={(e) => setPrefs((prev) => ({ ...prev, [key]: e.target.checked }))}
                  className="h-4 w-4 accent-insu-accent"
                />
                {PREF_LABELS[key]}
              </label>
            ))}
          </div>
        </div>

        {profileMsg && <p role="status" className="text-[13px] text-insu-dim">{profileMsg}</p>}

        <button type="submit" disabled={savingProfile} className="rounded-lg bg-insu-accent px-5 py-2.5 text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a] disabled:opacity-50">
          {savingProfile ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      {/* Change password */}
      <form onSubmit={savePassword} className={cardCls + ' space-y-4'}>
        <h2 className="text-[15px] font-semibold text-insu-text">Change password</h2>
        <div>
          <label htmlFor="new-password" className={labelCls}>New password</label>
          <input id="new-password" type="password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} className={fieldCls} />
        </div>
        {pwMsg && <p role="status" className="text-[13px] text-insu-dim">{pwMsg}</p>}
        <button type="submit" disabled={savingPw} className="rounded-lg border border-white/[0.07] px-5 py-2.5 text-[14px] font-semibold text-insu-text transition-colors hover:border-white/15 disabled:opacity-50">
          {savingPw ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  )
}
