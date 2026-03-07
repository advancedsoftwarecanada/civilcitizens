'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { IconType } from 'react-icons'
import { HiOutlineCog6Tooth, HiOutlineFlag, HiOutlineNoSymbol } from 'react-icons/hi2'
import Modal from './Modal'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import { pushToast } from './useToasts'

type ModerationTargetType = 'POST' | 'ORGANIZATION' | 'MARKET_LISTING' | 'MARKET_PRODUCT'
type ReportReasonValue =
  | 'spam_or_scam'
  | 'hate_or_harassment'
  | 'violence_or_threats'
  | 'sexual_or_explicit'
  | 'child_safety'
  | 'impersonation'
  | 'misinformation'
  | 'illegal_goods_or_services'
  | 'copyright_or_ip'
  | 'other'

type MenuAction = {
  key: string
  label: string
  icon: IconType
  tone?: 'default' | 'danger'
  disabled?: boolean
  onSelect: () => void | Promise<void>
}

type ReportTarget = {
  targetType: ModerationTargetType
  targetId: string
  targetLabel: string
}

type BlockTarget =
  | {
      type: 'user'
      id: string
      label: string
    }
  | {
      type: 'organization'
      id: string
      label: string
    }

type ContentModerationMenuProps = {
  reportTarget?: ReportTarget | null
  blockTarget?: BlockTarget | null
  actions?: MenuAction[]
  className?: string
  buttonClassName?: string
  menuClassName?: string
  align?: 'left' | 'right'
  buttonLabel?: string
  onReported?: () => void
  onBlocked?: () => void
}

const REPORT_REASON_OPTIONS: Array<{
  value: ReportReasonValue
  label: string
  description: string
}> = [
  {
    value: 'spam_or_scam',
    label: 'Spam or scam',
    description: 'Fraud, phishing, fake listings, or repetitive spam.',
  },
  {
    value: 'hate_or_harassment',
    label: 'Hate or harassment',
    description: 'Bullying, abuse, slurs, or targeted harassment.',
  },
  {
    value: 'violence_or_threats',
    label: 'Violence or threats',
    description: 'Threats, violent content, or calls for harm.',
  },
  {
    value: 'sexual_or_explicit',
    label: 'Sexual or explicit',
    description: 'Pornographic, explicit, or adult sexual material.',
  },
  {
    value: 'child_safety',
    label: 'Child safety',
    description: 'Any content that risks the safety or exploitation of minors.',
  },
  {
    value: 'impersonation',
    label: 'Impersonation',
    description: 'Pretending to be another person, business, or public figure.',
  },
  {
    value: 'misinformation',
    label: 'Misinformation',
    description: 'False claims presented as fact in a harmful way.',
  },
  {
    value: 'illegal_goods_or_services',
    label: 'Illegal goods or services',
    description: 'Weapons, drugs, trafficking, or other unlawful trade.',
  },
  {
    value: 'copyright_or_ip',
    label: 'Copyright or IP',
    description: 'Stolen content, trademark misuse, or piracy.',
  },
  {
    value: 'other',
    label: 'Other',
    description: 'Something else that still needs moderator review.',
  },
]

function toggleReason(current: ReportReasonValue[], next: ReportReasonValue) {
  return current.includes(next) ? current.filter((value) => value !== next) : [...current, next]
}

export default function ContentModerationMenu({
  reportTarget = null,
  blockTarget = null,
  actions = [],
  className,
  buttonClassName,
  menuClassName,
  align = 'right',
  buttonLabel = 'Content settings',
  onReported,
  onBlocked,
}: ContentModerationMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const [selectedReasons, setSelectedReasons] = useState<ReportReasonValue[]>([])
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [menuOpen])

  const resolvedActions = useMemo<MenuAction[]>(() => {
    const nextActions = [...actions]
    if (reportTarget) {
      nextActions.push({
        key: 'report',
        label: 'Report',
        icon: HiOutlineFlag,
        onSelect: () => {
          setSelectedReasons([])
          setDetails('')
          setReportOpen(true)
        },
      })
    }
    if (blockTarget) {
      nextActions.push({
        key: 'block',
        label: blockTarget.type === 'organization' ? 'Block this organization' : 'Block this user',
        icon: HiOutlineNoSymbol,
        tone: 'danger',
        onSelect: () => setBlockOpen(true),
      })
    }
    return nextActions
  }, [actions, blockTarget, reportTarget])

  const requireToken = () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return null
    }
    return token
  }

  const handleReportSubmit = async () => {
    if (!reportTarget || busy || selectedReasons.length === 0) return
    const token = requireToken()
    if (!token) return

    setBusy(true)
    try {
      const response = await fetch(buildApiUrl('/moderation/reports'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          targetType: reportTarget.targetType,
          targetId: reportTarget.targetId,
          reasons: selectedReasons,
          details: details.trim() || null,
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        pushToast(payload?.error ?? 'Unable to report this content right now.', 'error')
        return
      }

      pushToast('Report submitted. This content has been quarantined for review. Track it in Settings > Customer Support.', 'success')
      setReportOpen(false)
      setMenuOpen(false)
      onReported?.()
    } catch {
      pushToast('Unable to report this content right now.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleBlockConfirm = async () => {
    if (!blockTarget || busy) return
    const token = requireToken()
    if (!token) return

    setBusy(true)
    try {
      const path = blockTarget.type === 'organization' ? '/moderation/blocks/organizations' : '/moderation/blocks/users'
      const body =
        blockTarget.type === 'organization'
          ? { businessId: blockTarget.id }
          : { userId: blockTarget.id }

      const response = await fetch(buildApiUrl(path), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        pushToast(payload?.error ?? 'Unable to block this account right now.', 'error')
        return
      }

      pushToast(blockTarget.type === 'organization' ? 'Organization blocked.' : 'User blocked.', 'success')
      setBlockOpen(false)
      setMenuOpen(false)
      onBlocked?.()
    } catch {
      pushToast('Unable to block this account right now.', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (resolvedActions.length === 0) return null

  return (
    <>
      <div ref={menuRef} className={clsx('relative', className)}>
        <button
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
          className={clsx(
            'inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-slate-950/45 text-white shadow-lg backdrop-blur-md transition hover:border-[var(--cc-primary)] hover:bg-slate-950/60',
            buttonClassName,
          )}
          aria-label={buttonLabel}
        >
          <HiOutlineCog6Tooth className="h-5 w-5" />
        </button>

        {menuOpen ? (
          <div
            className={clsx(
              'absolute top-full z-40 mt-2 w-56 rounded-2xl border border-slate-200 bg-white py-1.5 shadow-[0_20px_40px_rgba(15,23,42,0.18)]',
              align === 'right' ? 'right-0' : 'left-0',
              menuClassName,
            )}
          >
            {resolvedActions.map((action) => {
              const Icon = action.icon
              return (
                <button
                  key={action.key}
                  type="button"
                  disabled={action.disabled}
                  onClick={() => {
                    setMenuOpen(false)
                    void action.onSelect()
                  }}
                  className={clsx(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60',
                    action.tone === 'danger'
                      ? 'text-rose-700 hover:bg-rose-50'
                      : 'text-slate-700 hover:bg-slate-50',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{action.label}</span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <Modal open={reportOpen} onClose={() => !busy && setReportOpen(false)} title="Report content" maxWidthClassName="max-w-2xl">
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold text-slate-900">{reportTarget?.targetLabel || 'Select the problem'}</p>
            <p className="mt-1 text-sm text-slate-500">Choose every issue that applies. Civil will quarantine the content immediately for review.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {REPORT_REASON_OPTIONS.map((reason) => {
              const checked = selectedReasons.includes(reason.value)
              return (
                <label
                  key={reason.value}
                  className={clsx(
                    'flex cursor-pointer gap-3 rounded-2xl border px-4 py-3 transition',
                    checked
                      ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/5'
                      : 'border-slate-200 bg-white hover:border-slate-300',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setSelectedReasons((current) => toggleReason(current, reason.value))}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-[var(--cc-primary)] focus:ring-[var(--cc-primary)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">{reason.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">{reason.description}</span>
                  </span>
                </label>
              )
            })}
          </div>

          <div className="space-y-2">
            <label htmlFor="report-details" className="text-sm font-semibold text-slate-900">
              Details
            </label>
            <textarea
              id="report-details"
              rows={5}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="Add any context that helps moderators review this faster."
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--cc-primary)] focus:ring-1 focus:ring-[var(--cc-primary)]"
              maxLength={2000}
            />
            <p className="text-xs leading-5 text-slate-500">
              Filed reports appear in <a href="/settings/support#reported-content" className="font-semibold text-[var(--cc-primary)] hover:underline">Customer Support</a> after submission.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setReportOpen(false)}
              disabled={busy}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void handleReportSubmit()
              }}
              disabled={busy || selectedReasons.length === 0}
              className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--cc-primary-700)] disabled:opacity-60"
            >
              {busy ? 'Submitting…' : 'Submit report'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={blockOpen}
        onClose={() => !busy && setBlockOpen(false)}
        title={blockTarget?.type === 'organization' ? 'Block organization' : 'Block user'}
        maxWidthClassName="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            {blockTarget?.type === 'organization'
              ? `Hide ${blockTarget.label} and future content from this organization in your Civil experience.`
              : `Hide ${blockTarget?.label} and future content from this person in your Civil experience.`}
          </p>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Blocking only affects your account. It does not notify the other side.
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setBlockOpen(false)}
              disabled={busy}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void handleBlockConfirm()
              }}
              disabled={busy}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {busy ? 'Blocking…' : 'Confirm block'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
