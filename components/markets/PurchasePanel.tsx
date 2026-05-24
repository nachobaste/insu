'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { cn, formatCurrency } from '@/lib/utils'
import type { ContractWithTiers } from '@/lib/types'
import { computePeriodFactor } from '@/lib/pricing/engine'
import TierSelector from './TierSelector'
import AuthGate from './AuthGate'
import StripePaymentForm from './StripePaymentForm'
import { createHedgerPaymentIntent, createProviderPaymentIntent, activatePositionByPaymentIntent } from '@/lib/actions/purchase'

type PanelMode = 'buy' | 'provide'
type Step = 'select' | 'payment' | 'done'

const PERIOD_OPTIONS = [
  { days: 1,  label: '1 day' },
  { days: 7,  label: '7 days' },
  { days: 30, label: '30 days' },
] as const

interface Props {
  contract: ContractWithTiers
  userId: string | null
  open: boolean
  initialMode: PanelMode
  initialPeriodDays?: number | null
  onClose: () => void
}

export default function PurchasePanel({ contract, userId, open, initialMode, initialPeriodDays, onClose }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<PanelMode>(initialMode)
  const [step, setStep] = useState<Step>('select')
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null)
  const [selectedPeriodDays, setSelectedPeriodDays] = useState<number | null>(initialPeriodDays ?? null)
  const [depositAmount, setDepositAmount] = useState('')
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSelectedPeriodDays(initialPeriodDays ?? null)
  }, [initialPeriodDays])

  const isRecurring =
    contract.trigger_type === 'weather' || contract.trigger_type === 'urban'

  const periodFactor =
    isRecurring && selectedPeriodDays
      ? computePeriodFactor(selectedPeriodDays, contract)
      : 1.0

  const basicTier = [...contract.coverage_tiers].sort((a, b) =>
    a.name === 'basic' ? -1 : b.name === 'basic' ? 1 : 0,
  )[0]

  const selectedTier = contract.coverage_tiers.find((t) => t.id === selectedTierId)

  function switchMode(next: PanelMode) {
    setMode(next)
    setSelectedTierId(null)
    setSelectedPeriodDays(initialPeriodDays ?? null)
    setStep('select')
    setClientSecret(null)
    setError(null)
  }

  function handleClose() {
    setStep('select')
    setSelectedTierId(null)
    setSelectedPeriodDays(initialPeriodDays ?? null)
    setClientSecret(null)
    setError(null)
    onClose()
  }

  async function handleContinue() {
    if (!selectedTierId) return
    setLoading(true)
    setError(null)

    try {
      const result =
        mode === 'buy'
          ? await createHedgerPaymentIntent(selectedTierId, selectedPeriodDays ?? undefined)
          : await createProviderPaymentIntent(selectedTierId, parseFloat(depositAmount) || 0)

      if ('error' in result) {
        setError(result.error)
        return
      }
      setClientSecret(result.clientSecret)
      setStep('payment')
    } catch {
      setError('Something went wrong — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={handleClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Purchase panel"
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-bg-card shadow-2xl transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-6 py-5">
          <span className="line-clamp-1 text-[14px] font-semibold text-insu-text">
            {contract.title}
          </span>
          <button
            onClick={handleClose}
            aria-label="Close panel"
            className="ml-4 rounded-lg p-1.5 text-insu-muted transition-colors hover:bg-white/5 hover:text-insu-text"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!userId ? (
            <AuthGate next={`/markets/${contract.slug}`} />
          ) : step === 'done' ? (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="text-4xl">✓</div>
              <p className="text-[15px] font-semibold text-insu-text">
                {mode === 'buy' ? 'Protection confirmed!' : 'Capital deposited!'}
              </p>
              {mode === 'buy' && selectedTier && (
                <p className="text-[13px] text-insu-muted">
                  You&apos;re covered up to{' '}
                  <span className="font-semibold text-insu-green">
                    ${selectedTier.payout_usd.toLocaleString()}
                  </span>
                </p>
              )}
              <button
                onClick={() => { handleClose(); router.push('/dashboard') }}
                className="mt-2 rounded-lg bg-insu-accent px-6 py-2.5 text-[14px] font-bold text-bg"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Mode toggle */}
              <div className="mb-5 flex rounded-lg bg-bg p-1">
                {(['buy', 'provide'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => switchMode(m)}
                    className={cn(
                      'flex-1 rounded-md py-2 text-[13px] font-semibold transition-all',
                      mode === m ? 'bg-insu-accent text-bg' : 'text-insu-muted hover:text-insu-text',
                    )}
                  >
                    {m === 'buy' ? 'Buy Protection' : 'Provide Capital'}
                  </button>
                ))}
              </div>

              {step === 'select' ? (
                <>
                  {/* Period selector — recurring buy only */}
                  {isRecurring && mode === 'buy' && (
                    <div className="mb-5">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-insu-muted">
                        Coverage period
                      </p>
                      <div className="flex gap-2">
                        {PERIOD_OPTIONS.map(({ days, label }) => {
                          const pf = computePeriodFactor(days, contract)
                          const fromPrice = formatCurrency(
                            Math.round(basicTier.premium_usd * pf * 100) / 100,
                            'USD',
                          )
                          return (
                            <button
                              key={days}
                              onClick={() => setSelectedPeriodDays(days)}
                              className={cn(
                                'flex flex-1 flex-col items-center rounded-lg border py-2.5 text-[11px] font-semibold transition-all',
                                selectedPeriodDays === days
                                  ? 'border-insu-accent/50 bg-insu-accent/5 text-insu-accent'
                                  : 'border-white/[0.07] bg-bg-card text-insu-muted hover:border-white/15',
                              )}
                            >
                              {label}
                              <span className="mt-0.5 font-mono text-[9px] font-normal opacity-70">
                                from {fromPrice}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-insu-muted">
                    Select tier
                  </p>
                  <TierSelector
                    tiers={contract.coverage_tiers}
                    selectedTierId={selectedTierId}
                    onSelect={setSelectedTierId}
                    mode={mode}
                    periodFactor={mode === 'buy' ? periodFactor : undefined}
                  />

                  {mode === 'provide' && selectedTierId && (
                    <div className="mt-4">
                      <label
                        htmlFor="deposit-amount"
                        className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-insu-muted"
                      >
                        Deposit amount (USD)
                      </label>
                      <input
                        id="deposit-amount"
                        type="number"
                        min="10"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        placeholder="e.g. 1000"
                        className="w-full rounded-lg border border-white/[0.07] bg-bg px-4 py-2.5 text-[14px] text-insu-text outline-none focus:border-insu-accent/40"
                      />
                    </div>
                  )}

                  {error && (
                    <p role="alert" className="mt-3 rounded-lg bg-red-500/10 px-4 py-2 text-[13px] text-red-400">
                      {error}
                    </p>
                  )}

                  <button
                    onClick={handleContinue}
                    disabled={
                      !selectedTierId ||
                      loading ||
                      (isRecurring && mode === 'buy' && selectedPeriodDays === null) ||
                      (mode === 'provide' && (!depositAmount || parseFloat(depositAmount) < 10))
                    }
                    className="mt-5 w-full rounded-lg bg-insu-accent py-3 text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a] disabled:opacity-40"
                  >
                    {loading ? 'Loading…' : 'Continue to payment'}
                  </button>
                </>
              ) : clientSecret && selectedTier ? (
                <StripePaymentForm
                  clientSecret={clientSecret}
                  amountUsd={mode === 'buy'
                    ? Math.round(selectedTier.premium_usd * periodFactor * 100) / 100
                    : parseFloat(depositAmount)}
                  onSuccess={async () => {
                    try {
                      const result = await activatePositionByPaymentIntent(clientSecret)
                      if ('error' in result) {
                        console.error('Activation failed:', result.error)
                        setError(`Activation error: ${result.error}`)
                        setStep('select')
                        return
                      }
                    } catch (err) {
                      console.error('Activation threw:', err)
                    }
                    setStep('done')
                  }}
                  onError={(msg) => { setError(msg); setStep('select') }}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  )
}
