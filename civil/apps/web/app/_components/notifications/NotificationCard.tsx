import clsx from 'clsx'
import Link from 'next/link'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { buildApiUrl } from '../../_lib/api'
import { getStoredToken } from '../../_lib/tokenStorage'
import Modal from '../Modal'
import VerifiedAvatar from '../VerifiedAvatar'
import type { FriendActionState, NotificationActionOptions, NotificationItem, ProfileFamilyRelationshipValue } from './notificationUtils'
import {
  formatRelativeTime,
  getActorDisplayName,
  getNotificationActionLabels,
  getFriendshipId,
  getNotificationFamilyInviteOptions,
  getNotificationOpenLabel,
  getNotificationRequestStatus,
  getNotificationMessage,
  getProfileFamilyRelationshipLabel,
  getNotificationTargetUrl,
  isActionableNotification,
} from './notificationUtils'

export type NotificationCardProps = {
  notification: NotificationItem
  onRequestAction?: (
    notification: NotificationItem,
    action: 'accept' | 'reject',
    options?: NotificationActionOptions,
  ) => void | boolean | Promise<void | boolean>
  friendActionState?: FriendActionState | null
  onOpen?: (notification: NotificationItem, targetUrl: string) => void
  variant?: 'default' | 'toast'
}

export function NotificationCard({
  notification,
  onRequestAction,
  friendActionState,
  onOpen,
  variant = 'default',
}: NotificationCardProps) {
  const formatMoney = (cents: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
  const friendshipId = getFriendshipId(notification)
  const actionable = isActionableNotification(notification)
  const requestStatus = actionable ? getNotificationRequestStatus(notification) : null
  const allowResponse = requestStatus === 'pending'
  const isResponding = friendActionState?.notificationId === notification.id
  const isAccepting = isResponding && friendActionState?.action === 'accept'
  const isRejecting = isResponding && friendActionState?.action === 'reject'
  const actionableRequestId = notification.type === 'friend_request' ? friendshipId : notification.id
  const profileHref = notification.actor?.handle ? `/u/${notification.actor.handle}` : null
  const addFamilyHref = profileHref ? `${profileHref}?addFamily=1` : null
  const reciprocalCompleted = notification.payload?.reciprocalCompleted === true
  const payloadActorName = typeof notification.payload?.childDisplayName === 'string' ? notification.payload.childDisplayName.trim() : ''
  const hasActorIdentity = Boolean(notification.actor || payloadActorName)
  const actorName = getActorDisplayName(notification)
  const initials = actorName || 'C'
  const message = getNotificationMessage(notification)
  const targetUrl = getNotificationTargetUrl(notification)
  const openLabel = getNotificationOpenLabel(notification)
  const actionLabels = getNotificationActionLabels(notification)
  const actorAvatarUrl = typeof notification.payload?.childAvatarUrl === 'string' && notification.payload.childAvatarUrl.trim()
    ? notification.payload.childAvatarUrl
    : null
  const isDriveTipReceived = notification.type === 'drive_ride_tip_received'
  const completionAction = typeof notification.payload?.action === 'string' ? notification.payload.action.trim().toLowerCase() : ''
  const completionRideId = typeof notification.payload?.rideRequestId === 'string' ? notification.payload.rideRequestId.trim() : ''
  const completionVehicleImageUrl = typeof notification.payload?.vehicleImageUrl === 'string' ? notification.payload.vehicleImageUrl.trim() : ''
  const completionVehicleLabel = typeof notification.payload?.vehicleLabel === 'string' ? notification.payload.vehicleLabel.trim() : ''
  const completionTipEligible = notification.payload?.tipEligible !== false
  const completionTippedAmountCents = typeof notification.payload?.tippedAmountCents === 'number' ? Math.max(0, Math.round(notification.payload.tippedAmountCents)) : null
  const actorCoverUrl = notification.actor?.coverUrl
    ?? (typeof notification.payload?.childCoverUrl === 'string' && notification.payload.childCoverUrl.trim() ? notification.payload.childCoverUrl : null)
    ?? (completionVehicleImageUrl || null)
  const resolvedActorAvatarUrl = notification.actor?.avatarUrl ?? actorAvatarUrl
  const hasActorCover = Boolean(actorCoverUrl)
  const [familyConfirmOpen, setFamilyConfirmOpen] = useState(false)
  const [selectedReciprocalRelationship, setSelectedReciprocalRelationship] = useState<ProfileFamilyRelationshipValue | null>(null)
  const [tipModalOpen, setTipModalOpen] = useState(false)
  const [selectedTipAmountCents, setSelectedTipAmountCents] = useState<number | null>(500)
  const [customTipAmount, setCustomTipAmount] = useState('')
  const [tipSubmitting, setTipSubmitting] = useState(false)
  const [tipError, setTipError] = useState<string | null>(null)
  const [tipSuccessAmountCents, setTipSuccessAmountCents] = useState<number | null>(null)
  const [tipAlreadySent, setTipAlreadySent] = useState(false)
  const effectiveTippedAmountCents = completionTippedAmountCents ?? tipSuccessAmountCents
  const showDriveRideTipPrompt = notification.type === 'drive_ride_contract_update' && completionAction === 'complete_contract' && completionTipEligible && !effectiveTippedAmountCents && !tipAlreadySent && Boolean(completionRideId)
  const familyInviteOptions = useMemo(() => getNotificationFamilyInviteOptions(notification), [notification])
  const incomingRelationshipLabel = getProfileFamilyRelationshipLabel(notification.payload?.relationship) ?? 'Family member'
  const requesterChild = notification.type === 'family_child_friend_request' && notification.payload?.requesterChild && typeof notification.payload.requesterChild === 'object' && !Array.isArray(notification.payload.requesterChild)
    ? (notification.payload.requesterChild as Record<string, unknown>)
    : null
  const requesterChildName = typeof requesterChild?.displayName === 'string' ? requesterChild.displayName : null
  const requesterChildUsername = typeof requesterChild?.username === 'string' ? requesterChild.username : null
  const requesterChildAvatarUrl = typeof requesterChild?.avatarUrl === 'string' ? requesterChild.avatarUrl : null
  const requesterChildCoverUrl = typeof requesterChild?.coverUrl === 'string' ? requesterChild.coverUrl : null

  const closeFamilyConfirmModal = () => {
    if (isResponding) return
    setFamilyConfirmOpen(false)
    setSelectedReciprocalRelationship(null)
  }

  const closeTipModal = () => {
    if (tipSubmitting) return
    setTipModalOpen(false)
    setTipError(null)
  }

  const resolveTipAmountCents = () => {
    if (selectedTipAmountCents) return selectedTipAmountCents
    const normalized = customTipAmount.trim().replace(/[^0-9.]/g, '')
    const amount = Number.parseFloat(normalized)
    if (!Number.isFinite(amount) || amount <= 0) return null
    return Math.round(amount * 100)
  }

  const handleCardClick = () => {
    if (familyConfirmOpen) return
    if (!targetUrl) return
    if (onOpen) {
      onOpen(notification, targetUrl)
      return
    }
    window.location.assign(targetUrl)
  }

  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (familyConfirmOpen) return
    if (!targetUrl) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      window.location.assign(targetUrl)
    }
  }

  return (
    <div
      className={clsx(
        'overflow-hidden rounded-2xl border px-4 py-3 text-sm text-slate-800',
        targetUrl && 'cursor-pointer transition',
        variant === 'toast'
          ? [
              isDriveTipReceived ? 'border-emerald-200 bg-emerald-50/95 shadow-2xl shadow-emerald-900/10 backdrop-blur-xl' : 'border-white/80 bg-white/95 shadow-2xl shadow-slate-900/15 backdrop-blur-xl',
              targetUrl && 'hover:border-slate-200 hover:bg-white',
            ]
          : [
              'shadow-sm',
              targetUrl && 'hover:border-slate-300 hover:bg-slate-50/70',
              isDriveTipReceived
                ? 'border-emerald-200 bg-emerald-50/70'
                : notification.unread
                  ? 'border-[var(--cc-primary)]/40 bg-white'
                  : 'border-slate-100 bg-white',
            ],
      )}
      onClick={familyConfirmOpen ? undefined : handleCardClick}
      onKeyDown={familyConfirmOpen ? undefined : handleCardKeyDown}
      role={targetUrl && !familyConfirmOpen ? 'button' : undefined}
      tabIndex={targetUrl && !familyConfirmOpen ? 0 : undefined}
    >
      <div className="space-y-2.5">
        <div className={clsx('relative overflow-hidden rounded-xl border px-3 py-2', hasActorCover ? 'border-slate-300' : isDriveTipReceived ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50')}>
          {actorCoverUrl ? <img src={actorCoverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
          <div className={clsx('absolute inset-0', hasActorCover ? 'bg-slate-900/50' : 'bg-transparent')} />
          <div className="relative z-[1] flex items-start gap-3">
            {notification.actor || resolvedActorAvatarUrl || payloadActorName ? (
              <VerifiedAvatar
                src={resolvedActorAvatarUrl}
                alt={actorName || notification.actor?.handle || 'Civil citizen'}
                initials={initials}
                size={44}
                isVerified={Boolean(notification.actor?.isVerified)}
                isBusiness={Boolean(notification.actor?.isPremium)}
                className="shrink-0"
                href={profileHref ?? undefined}
              />
            ) : (
              <div className="mt-1 h-10 w-10 shrink-0 rounded-full bg-slate-100" aria-hidden="true" />
            )}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className={clsx('h-2 w-2 rounded-full', notification.unread ? 'bg-[var(--cc-primary)]' : hasActorCover ? 'bg-white/60' : 'bg-slate-300')} aria-hidden="true" />
                {hasActorIdentity ? (
                  <div className="flex flex-wrap items-baseline gap-1 text-sm">
                    {profileHref ? (
                      <Link
                        href={profileHref}
                        className={clsx('font-semibold hover:underline', hasActorCover ? 'text-white' : 'text-slate-900')}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {actorName}
                      </Link>
                    ) : (
                      <span className={clsx('font-semibold', hasActorCover ? 'text-white' : 'text-slate-900')}>{actorName}</span>
                    )}
                  </div>
                ) : (
                  <p className={clsx('font-semibold', hasActorCover ? 'text-white' : 'text-slate-900')}>Notification</p>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="px-0.5">
          {isDriveTipReceived ? (
            <div className="mb-2 inline-flex rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-800">
              Tip received
            </div>
          ) : null}
          <p className="text-[15px] leading-5 text-slate-700">{message}</p>
          <p className="mt-1 text-xs text-slate-500">{formatRelativeTime(notification.createdAt)}</p>
        </div>
        {requesterChildName ? (
          <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
            {requesterChildCoverUrl ? <img src={requesterChildCoverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
            <div className={clsx('absolute inset-0', requesterChildCoverUrl ? 'bg-slate-950/45' : 'bg-transparent')} />
            <div className="relative z-[1] flex items-center gap-3">
              <VerifiedAvatar
                src={requesterChildAvatarUrl}
                alt={requesterChildName}
                initials={requesterChildName}
                size={42}
                className="shrink-0"
              />
              <div className="min-w-0">
                <p className={clsx('truncate text-sm font-semibold', requesterChildCoverUrl ? 'text-white' : 'text-slate-900')}>
                  {requesterChildName}
                </p>
                {requesterChildUsername ? (
                  <p className={clsx('truncate text-xs', requesterChildCoverUrl ? 'text-white/80' : 'text-slate-500')}>
                    @{requesterChildUsername}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        {actionable && onRequestAction && allowResponse ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex flex-1 items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={(event) => {
                event.stopPropagation()
                if (notification.type === 'profile_family_invite') {
                  setSelectedReciprocalRelationship(null)
                  setFamilyConfirmOpen(true)
                  return
                }
                onRequestAction(notification, 'accept')
              }}
              disabled={!actionableRequestId || isResponding}
            >
              {isAccepting ? `${actionLabels.acceptLabel}ing…` : actionLabels.acceptLabel}
            </button>
            <button
              type="button"
              className="inline-flex flex-1 items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={(event) => {
                event.stopPropagation()
                onRequestAction(notification, 'reject')
              }}
              disabled={!actionableRequestId || isResponding}
            >
              {isRejecting ? `${actionLabels.rejectLabel}…` : actionLabels.rejectLabel}
            </button>
          </div>
        ) : null}
        {notification.type === 'profile_family_invite' && requestStatus === 'accepted' && addFamilyHref && !reciprocalCompleted ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href={addFamilyHref}
              className="inline-flex flex-1 items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-lg transition hover:brightness-110"
              onClick={(event) => event.stopPropagation()}
            >
              Add Family
            </Link>
          </div>
        ) : actionable && requestStatus && !allowResponse ? (
          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            {requestStatus === 'accepted' ? 'Accepted' : 'Declined'}
          </div>
        ) : null}
        {notification.type === 'profile_family_invite' ? (
          <Modal open={familyConfirmOpen} onClose={closeFamilyConfirmModal} title="Confirm family relationship" maxWidthClassName="max-w-lg">
            <div className="space-y-4">
              <div className="space-y-2 text-sm leading-6 text-slate-700">
                <p>
                  <span className="font-semibold text-slate-900">{actorName ?? 'This user'}</span> has added you as their{' '}
                  <span className="font-semibold text-slate-900">{incomingRelationshipLabel}</span>.
                </p>
                <p>Choose how they should appear in your Family.</p>
              </div>

              <div className="space-y-2">
                {familyInviteOptions.map((option) => {
                  const selected = selectedReciprocalRelationship === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={clsx(
                        'flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition',
                        selected
                          ? 'border-red-600 bg-red-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700',
                      )}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setSelectedReciprocalRelationship(option.value)
                      }}
                      disabled={isResponding}
                    >
                      <span>{option.label}</span>
                      {selected ? <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-white/85">Selected</span> : null}
                    </button>
                  )
                })}
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    closeFamilyConfirmModal()
                  }}
                  disabled={isResponding}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-full bg-[var(--cc-primary)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={async (event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (!selectedReciprocalRelationship) return
                    const handled = await onRequestAction?.(notification, 'accept', {
                      reciprocalRelationship: selectedReciprocalRelationship,
                    })
                    if (handled !== false) {
                      closeFamilyConfirmModal()
                    }
                  }}
                  disabled={!selectedReciprocalRelationship || isResponding}
                >
                  {isAccepting ? 'Confirming…' : 'Confirm relationship'}
                </button>
              </div>
            </div>
          </Modal>
        ) : null}
        {showDriveRideTipPrompt ? (
          <Modal open={tipModalOpen} onClose={closeTipModal} title="Add tip" maxWidthClassName="max-w-md">
            <div className="space-y-4">
              <div className="space-y-2 text-sm text-slate-700">
                <p>Select a tip amount.</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[500, 1000, 2000, 5000].map((amount) => {
                  const selected = selectedTipAmountCents === amount
                  return (
                    <button
                      key={amount}
                      type="button"
                      className={clsx(
                        'rounded-2xl border px-4 py-3 text-sm font-semibold transition',
                        selected
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700',
                      )}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setSelectedTipAmountCents(amount)
                        setCustomTipAmount('')
                        setTipError(null)
                      }}
                      disabled={tipSubmitting}
                    >
                      {formatMoney(amount)}
                    </button>
                  )
                })}
              </div>

              <label className="block space-y-2 text-sm font-semibold text-slate-900">
                <span>Other amount</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="0.01"
                  placeholder="0.00"
                  value={customTipAmount}
                  onChange={(event) => {
                    setSelectedTipAmountCents(null)
                    setCustomTipAmount(event.target.value)
                    setTipError(null)
                  }}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  disabled={tipSubmitting}
                />
              </label>

              {tipError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{tipError}</div> : null}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    closeTipModal()
                  }}
                  disabled={tipSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={async (event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    const tipAmountCents = resolveTipAmountCents()
                    if (!tipAmountCents || tipAmountCents < 100) {
                      setTipError('Enter a valid tip amount.')
                      return
                    }
                    const token = getStoredToken()
                    if (!token) {
                      setTipError('Sign in is required to send a tip.')
                      return
                    }
                    setTipSubmitting(true)
                    setTipError(null)
                    try {
                      const response = await fetch(buildApiUrl(`/drive/rides/${encodeURIComponent(completionRideId)}/tip`), {
                        method: 'POST',
                        headers: {
                          'content-type': 'application/json',
                          authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ amountCents: tipAmountCents }),
                      })
                      const payload = (await response.json().catch(() => null)) as { error?: string } | null
                      if (!response.ok) {
                        if (payload?.error === 'tip_already_sent') {
                          setTipAlreadySent(true)
                          setTipModalOpen(false)
                          return
                        }
                        if (payload?.error === 'insufficient_wallet_balance') {
                          setTipError('Your wallet balance is too low for that tip.')
                          return
                        }
                        if (payload?.error === 'wallet_required') {
                          setTipError('Enable your wallet before sending a tip.')
                          return
                        }
                        setTipError('Unable to send the tip right now.')
                        return
                      }
                      setTipAlreadySent(false)
                      setTipSuccessAmountCents(tipAmountCents)
                      setTipModalOpen(false)
                    } catch {
                      setTipError('Unable to send the tip right now.')
                    } finally {
                      setTipSubmitting(false)
                    }
                  }}
                  disabled={tipSubmitting}
                >
                  {tipSubmitting ? 'Sending…' : 'Tip Driver'}
                </button>
              </div>
            </div>
          </Modal>
        ) : null}
        {!actionable && (targetUrl || showDriveRideTipPrompt || tipSuccessAmountCents || tipAlreadySent) ? (
          <div className="flex flex-wrap gap-2">
            {effectiveTippedAmountCents || tipAlreadySent ? (
              <div className="inline-flex items-center justify-center px-1 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                {effectiveTippedAmountCents ? `Tipped ${formatMoney(effectiveTippedAmountCents)}` : 'Tipped'}
              </div>
            ) : showDriveRideTipPrompt ? (
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setTipError(null)
                  setTipModalOpen(true)
                }}
              >
                Add Tip
              </button>
            ) : null}
            {targetUrl && openLabel ? (
            <Link
              href={targetUrl}
              className={clsx(
                'inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wide transition',
                notification.type === 'drive_ride_contract_update' && completionAction === 'complete_contract'
                  ? 'border border-emerald-300 bg-white text-emerald-700 hover:border-emerald-400 hover:text-emerald-800'
                  : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900',
              )}
              onClick={(event) => event.stopPropagation()}
            >
              {showDriveRideTipPrompt ? 'View' : openLabel}
            </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
