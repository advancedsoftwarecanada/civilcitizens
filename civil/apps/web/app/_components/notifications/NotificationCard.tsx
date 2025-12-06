import clsx from 'clsx'
import VerifiedAvatar from '../VerifiedAvatar'
import type { FriendActionState, NotificationItem } from './notificationUtils'
import { formatRelativeTime, getFriendshipId, getNotificationMessage } from './notificationUtils'

export type NotificationCardProps = {
  notification: NotificationItem
  onFriendAction?: (notification: NotificationItem, action: 'accept' | 'reject') => void
  friendActionState?: FriendActionState | null
}

export function NotificationCard({ notification, onFriendAction, friendActionState }: NotificationCardProps) {
  const friendshipId = getFriendshipId(notification)
  const isResponding = friendActionState?.notificationId === notification.id
  const isAccepting = isResponding && friendActionState?.action === 'accept'
  const isRejecting = isResponding && friendActionState?.action === 'reject'
  const initials = notification.actor?.name ?? notification.actor?.handle ?? 'C'

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
          />
        ) : (
          <div className="mt-1 h-10 w-10 shrink-0 rounded-full bg-slate-100" aria-hidden="true" />
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={clsx('h-2 w-2 rounded-full', notification.unread ? 'bg-[var(--cc-primary)]' : 'bg-slate-300')} aria-hidden="true" />
            <p className="font-semibold text-slate-900">{getNotificationMessage(notification)}</p>
          </div>
          {notification.actor?.handle ? <p className="text-xs text-slate-500">@{notification.actor.handle}</p> : null}
          <p className="mt-1 text-xs text-slate-500">{formatRelativeTime(notification.createdAt)}</p>
          {notification.type === 'friend_request' && onFriendAction ? (
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
        </div>
      </div>
    </div>
  )
}
