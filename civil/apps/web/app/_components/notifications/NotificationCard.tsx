import clsx from 'clsx'
import Link from 'next/link'
import VerifiedAvatar from '../VerifiedAvatar'
import type { FriendActionState, NotificationItem } from './notificationUtils'
import {
  formatRelativeTime,
  getActorDisplayName,
  getFriendshipId,
  getFriendRequestStatus,
  getNotificationMessage,
} from './notificationUtils'

export type NotificationCardProps = {
  notification: NotificationItem
  onFriendAction?: (notification: NotificationItem, action: 'accept' | 'reject') => void
  friendActionState?: FriendActionState | null
}

export function NotificationCard({ notification, onFriendAction, friendActionState }: NotificationCardProps) {
  const friendshipId = getFriendshipId(notification)
  const requestStatus = notification.type === 'friend_request' ? getFriendRequestStatus(notification) : null
  const allowResponse = requestStatus === 'pending'
  const isResponding = friendActionState?.notificationId === notification.id
  const isAccepting = isResponding && friendActionState?.action === 'accept'
  const isRejecting = isResponding && friendActionState?.action === 'reject'
  const profileHref = notification.actor?.handle ? `/u/${notification.actor.handle}` : null
  const actorName = notification.actor ? getActorDisplayName(notification) : null
  const initials = actorName ?? 'C'
  const message = getNotificationMessage(notification)

  return (
    <div
      className={clsx(
        'rounded-2xl border px-4 py-3 text-sm text-slate-800 shadow-sm',
        notification.unread ? 'border-[var(--cc-primary)]/40 bg-[var(--cc-primary)]/5' : 'border-slate-100 bg-white',
      )}
    >
      <div className="flex items-start gap-3">
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
            <span className={clsx('h-2 w-2 rounded-full', notification.unread ? 'bg-[var(--cc-primary)]' : 'bg-slate-300')} aria-hidden="true" />
            {actorName ? (
              <div className="flex flex-wrap items-baseline gap-1 text-sm">
                {profileHref ? (
                  <Link href={profileHref} className="font-semibold text-slate-900 hover:underline">
                    {actorName}
                  </Link>
                ) : (
                  <span className="font-semibold text-slate-900">{actorName}</span>
                )}
                <span className="text-slate-600">{message}</span>
              </div>
            ) : (
              <p className="font-semibold text-slate-900">{message}</p>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">{formatRelativeTime(notification.createdAt)}</p>
          {notification.type === 'friend_request' && onFriendAction && allowResponse ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => onFriendAction(notification, 'accept')}
                disabled={!friendshipId || isResponding}
              >
                {isAccepting ? 'Accepting…' : 'Accept'}
              </button>
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => onFriendAction(notification, 'reject')}
                disabled={!friendshipId || isResponding}
              >
                {isRejecting ? 'Declining…' : 'Decline'}
              </button>
            </div>
          ) : null}
          {notification.type === 'friend_request' && requestStatus && !allowResponse ? (
            <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              {requestStatus === 'accepted' ? 'Friend request accepted' : 'Friend request dismissed'}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
