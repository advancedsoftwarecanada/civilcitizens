import clsx from 'clsx'
import Link from 'next/link'
import { useMemo, useState, type KeyboardEvent } from 'react'
import Modal from '../Modal'
import VerifiedAvatar from '../VerifiedAvatar'
import type { FriendActionState, NotificationActionOptions, NotificationItem, ProfileFamilyRelationshipValue } from './notificationUtils'
import {
  formatRelativeTime,
  getActorDisplayName,
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
  const actorName = notification.actor ? getActorDisplayName(notification) : null
  const initials = actorName ?? 'C'
  const message = getNotificationMessage(notification)
  const targetUrl = getNotificationTargetUrl(notification)
  const openLabel = getNotificationOpenLabel(notification)
  const actorCoverUrl = notification.actor?.coverUrl ?? null
  const hasActorCover = Boolean(actorCoverUrl)
  const [familyConfirmOpen, setFamilyConfirmOpen] = useState(false)
  const [selectedReciprocalRelationship, setSelectedReciprocalRelationship] = useState<ProfileFamilyRelationshipValue | null>(null)
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
              'border-white/80 bg-white/95 shadow-2xl shadow-slate-900/15 backdrop-blur-xl',
              targetUrl && 'hover:border-slate-200 hover:bg-white',
            ]
          : [
              'shadow-sm',
              targetUrl && 'hover:border-slate-300 hover:bg-slate-50/70',
              notification.unread ? 'border-[var(--cc-primary)]/40 bg-white' : 'border-slate-100 bg-white',
            ],
      )}
      onClick={familyConfirmOpen ? undefined : handleCardClick}
      onKeyDown={familyConfirmOpen ? undefined : handleCardKeyDown}
      role={targetUrl && !familyConfirmOpen ? 'button' : undefined}
      tabIndex={targetUrl && !familyConfirmOpen ? 0 : undefined}
    >
      <div className="space-y-2.5">
        <div className={clsx('relative overflow-hidden rounded-xl border px-3 py-2', hasActorCover ? 'border-slate-300' : 'border-slate-200 bg-slate-50')}>
          {actorCoverUrl ? <img src={actorCoverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
          <div className={clsx('absolute inset-0', hasActorCover ? 'bg-slate-900/50' : 'bg-transparent')} />
          <div className="relative z-[1] flex items-start gap-3">
            {notification.actor ? (
              <VerifiedAvatar
                src={notification.actor.avatarUrl ?? null}
                alt={notification.actor.name ?? notification.actor.handle ?? 'Civil citizen'}
                initials={initials}
                size={44}
                isVerified={Boolean(notification.actor.isVerified)}
                isBusiness={Boolean(notification.actor.isPremium)}
                className="shrink-0"
                href={profileHref ?? undefined}
              />
            ) : (
              <div className="mt-1 h-10 w-10 shrink-0 rounded-full bg-slate-100" aria-hidden="true" />
            )}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className={clsx('h-2 w-2 rounded-full', notification.unread ? 'bg-[var(--cc-primary)]' : hasActorCover ? 'bg-white/60' : 'bg-slate-300')} aria-hidden="true" />
                {actorName ? (
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
              {isAccepting ? 'Accepting…' : 'Accept'}
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
              {isRejecting ? 'Declining…' : 'Decline'}
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
        {!actionable && targetUrl && openLabel ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href={targetUrl}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
              onClick={(event) => event.stopPropagation()}
            >
              {openLabel}
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  )
}
