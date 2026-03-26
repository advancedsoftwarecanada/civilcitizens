'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { LuCircleSlash, LuRepeat2, LuWallet } from 'react-icons/lu'
import { calculateCausePlatformFeeCents } from '@civil/shared'
import type { ApiPost } from './PostComposer'
import CauseBackModal from './CauseBackModal'
import Modal from './Modal'
import { redirectToAuthModal } from '../_lib/authModal'
import { useViewerStore } from '../_lib/viewerStore'

function formatCurrency(amountCents: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format((amountCents || 0) / 100)
}

function formatContributions(count: number) {
  if (count === 1) return '1 backing'
  return `${count.toLocaleString()} backings`
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function readAmountCents(value: string) {
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.round(numeric * 100)
}

export default function CauseSummaryCard({
  post,
  onPostUpdate,
  compact = false,
}: {
  post: ApiPost
  onPostUpdate?: (post: ApiPost) => void
  compact?: boolean
}) {
  const viewer = useViewerStore((state) => state.me)
  const [modalOpen, setModalOpen] = useState(false)
  const [selfSupportModalOpen, setSelfSupportModalOpen] = useState(false)
  const [preferredSupportMode, setPreferredSupportMode] = useState<'one-time' | 'monthly'>('one-time')
  const [amountInput, setAmountInput] = useState('25')
  const cause = post.cause
  const amountCents = useMemo(() => readAmountCents(amountInput), [amountInput])
  const feeCents = useMemo(() => calculateCausePlatformFeeCents(amountCents), [amountCents])
  const totalChargeCents = amountCents + feeCents

  const isActive = cause?.status === 'active'
  const isAuthor = Boolean(viewer?.id && post.author.id === viewer.id)
  const progressLabel = useMemo(() => {
    if (!cause) return null
    return `${cause.progressPercent}% funded`
  }, [cause])
  const walletBalanceCents = viewer?.wallet?.civilCreditsCents ?? 0
  const currentSubscription = viewer?.wallet?.causeSubscriptions?.find((item) => item.postId === post.id && item.status !== 'canceled') ?? null
  const sortedStageGoals = useMemo(() => [...(cause?.stageGoals ?? [])].sort((left, right) => left.sortOrder - right.sortOrder), [cause?.stageGoals])
  const supportPresets = ['10', '25', '50', '100']

  if (!cause) return null

  function openSupportModal(mode: 'one-time' | 'monthly') {
    if (isAuthor) {
      setSelfSupportModalOpen(true)
      return
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!isActive) return
    setPreferredSupportMode(mode)
    setModalOpen(true)
  }

  const modalContent = (
    <>
      {modalOpen ? (
        <CauseBackModal
          post={post}
          initialAmountInput={amountInput}
          preferredMode={preferredSupportMode}
          onClose={() => setModalOpen(false)}
          onComplete={(nextPost) => onPostUpdate?.(nextPost)}
        />
      ) : null}

      {selfSupportModalOpen ? (
        <Modal open onClose={() => setSelfSupportModalOpen(false)} title="Own Cause">
          <div className="space-y-4 p-6">
            <p className="text-sm text-slate-700">You cannot donate to your own cause.</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSelfSupportModalOpen(false)}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  )

  if (!compact) {
    let runningGoalCents = 0

    return (
      <>
        <section className="space-y-4 rounded-[2rem] border border-emerald-200 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_40%),linear-gradient(180deg,#ffffff,#f4fbf7)] p-5 shadow-sm sm:p-6">
          <div className="rounded-[1.75rem] border border-emerald-100 bg-white/90 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Civil Cause</p>
                <h3 className="mt-2 text-xl font-semibold text-slate-900">Funding roadmap</h3>
              </div>
              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">
                {progressLabel}
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="font-semibold text-slate-900">{formatCurrency(cause.raisedAmountCents)} raised</span>
                <span className="text-slate-600">Goal {formatCurrency(cause.goalAmountCents)}</span>
              </div>
              <div className="h-4 overflow-hidden rounded-full bg-emerald-100">
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#10b981,#34d399)] transition-[width] duration-300" style={{ width: `${Math.max(4, cause.progressPercent)}%` }} />
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                <span>{formatContributions(cause.contributionCount)}</span>
                <span>{formatCurrency(cause.remainingAmountCents)} left</span>
                {cause.lastContributionAt ? <span>Last support {formatDateLabel(cause.lastContributionAt) ?? 'recently'}</span> : null}
              </div>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Support</p>
                <h4 className="mt-1 text-xl font-semibold text-slate-900">Back this Cause</h4>
              </div>
              <Link href="/wallet" className="text-sm font-semibold text-emerald-700 underline underline-offset-4">
                Open wallet
              </Link>
            </div>

            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <div className="flex items-center justify-between gap-3">
                <span>Wallet balance</span>
                <span className="font-semibold">{formatCurrency(walletBalanceCents)}</span>
              </div>
            </div>

            {currentSubscription ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-semibold text-slate-900">Current monthly support</span>
                  <span>{formatCurrency(currentSubscription.amountCents)} monthly</span>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {currentSubscription.status === 'paused'
                    ? 'Paused'
                    : currentSubscription.nextChargeAt
                      ? `Next charge ${formatDateLabel(currentSubscription.nextChargeAt) ?? 'soon'}`
                      : 'Active'}
                </div>
              </div>
            ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {supportPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmountInput(preset)}
                className={clsx(
                  'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                  amountInput === preset ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                ${preset}
              </button>
            ))}
          </div>

          <label className="mt-4 block">
            <span className="text-sm font-semibold text-slate-700">Support amount</span>
            <div className="mt-2 flex items-center overflow-hidden rounded-2xl border border-slate-200">
              <span className="border-r border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">CAD</span>
              <input
                type="number"
                min="5"
                step="1"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                className="w-full px-4 py-3 text-base text-slate-900 outline-none"
              />
            </div>
          </label>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-700">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span>Support amount</span>
              <span className="font-semibold text-slate-900">{formatCurrency(amountCents)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-200">
              <span>Civil fee</span>
              <span className="font-semibold text-slate-900">{formatCurrency(feeCents)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-4 border-t border-slate-200 bg-white text-base">
              <span className="font-semibold text-slate-900">Total wallet charge</span>
              <span className="font-semibold text-slate-900">{formatCurrency(totalChargeCents)}</span>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => openSupportModal('one-time')}
              disabled={!isActive && !isAuthor}
              className={clsx(
                'inline-flex items-center justify-center rounded-full px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed',
                isAuthor
                  ? 'bg-slate-300 text-slate-700 hover:bg-slate-300'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300',
              )}
            >
              {isAuthor ? <LuCircleSlash className="mr-2 h-4 w-4" /> : <LuWallet className="mr-2 h-4 w-4" />}
              Donate Once
            </button>
            <button
              type="button"
              onClick={() => openSupportModal('monthly')}
              disabled={!isActive && !isAuthor}
              className={clsx(
                'inline-flex items-center justify-center rounded-full px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed',
                isAuthor
                  ? 'bg-slate-300 text-slate-700 hover:bg-slate-300'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300',
              )}
            >
              {isAuthor ? <LuCircleSlash className="mr-2 h-4 w-4" /> : <LuRepeat2 className="mr-2 h-4 w-4" />}
              Donate Monthly
            </button>
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Stage Goals</p>
            <h4 className="mt-1 text-lg font-semibold text-slate-900">Goals</h4>
          </div>

          <div className="mt-4 space-y-3">
            {sortedStageGoals.length ? (
              sortedStageGoals.map((goal) => {
                const stageStart = runningGoalCents
                runningGoalCents += goal.amountCents
                const complete = cause.raisedAmountCents >= runningGoalCents
                const current = !complete && cause.raisedAmountCents >= stageStart
                const remainingForStage = Math.max(0, runningGoalCents - cause.raisedAmountCents)

                return (
                  <div
                    key={goal.id}
                    className={clsx(
                      'rounded-[1.5rem] border px-4 py-4 transition',
                      complete ? 'border-emerald-200 bg-emerald-50/80' : current ? 'border-amber-200 bg-amber-50/80' : 'border-slate-200 bg-slate-50',
                    )}
                  >
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{goal.description}</p>
                          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Stage {goal.sortOrder + 1}</p>
                        </div>
                        <p className="text-sm font-semibold text-slate-900">{formatCurrency(goal.amountCents)}</p>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                        <span>
                          {complete ? 'Complete' : current ? `${formatCurrency(remainingForStage)} to finish this stage` : 'Upcoming'}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No stage goals were added to this Cause.
              </div>
            )}
          </div>
          </div>
        </section>
        {modalContent}
      </>
    )
  }

  return (
    <>
      <section
        className={clsx(
          'rounded-3xl border border-emerald-200 bg-[linear-gradient(135deg,rgba(16,185,129,0.10),rgba(255,255,255,0.92))]',
          compact ? 'space-y-3 px-4 py-3' : 'space-y-4 p-4',
        )}
      >
        {compact ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-slate-900">Project Goal {formatCurrency(cause.goalAmountCents)}</span>
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">{progressLabel}</span>
            </div>
            <div className="overflow-hidden rounded-full bg-white/80 h-4">
              <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-300" style={{ width: `${Math.max(6, cause.progressPercent)}%` }} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-medium text-slate-600">
              <span>{formatCurrency(cause.raisedAmountCents)} raised</span>
              <span>{formatContributions(cause.contributionCount)}</span>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Civil Cause</p>
                  {post.title ? <h3 className="text-lg font-semibold text-slate-900">{post.title}</h3> : null}
                  <p className="text-sm text-slate-600">Funds move into the creator&apos;s Civil Wallet and can be withdrawn via Stripe Connect.</p>
                </>
              </div>
              <button
                type="button"
                onClick={() => {
                  openSupportModal('one-time')
                }}
                disabled={!isActive && !isAuthor}
                className={clsx(
                  'inline-flex items-center justify-center rounded-full text-sm font-semibold transition disabled:cursor-not-allowed',
                  isAuthor
                    ? 'bg-slate-300 text-slate-700 hover:bg-slate-300'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300',
                  'px-4 py-2',
                )}
              >
                {isAuthor ? <LuCircleSlash className="mr-2 h-4 w-4" /> : <LuWallet className="mr-2 h-4 w-4" />}
                {cause.status === 'funded' ? 'Goal reached' : cause.status === 'closed' ? 'Cause closed' : 'Back this Cause'}
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold text-slate-900">{formatCurrency(cause.raisedAmountCents)} raised</span>
                <span className="text-slate-600">Goal {formatCurrency(cause.goalAmountCents)}</span>
              </div>
              <div className="overflow-hidden rounded-full bg-white/80 h-3">
                <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-300" style={{ width: `${Math.max(6, cause.progressPercent)}%` }} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>{progressLabel}</span>
                <span>{formatContributions(cause.contributionCount)}</span>
                <span>{formatCurrency(cause.remainingAmountCents)} left</span>
              </div>
            </div>

            <p className="text-xs text-slate-500">Report suspicious Causes using the post menu. Civil does not provide escrow or milestone holds in this MVP.</p>
          </>
        )}
      </section>

      {modalContent}
    </>
  )
}