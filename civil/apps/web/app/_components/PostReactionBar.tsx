"use client"

import clsx from 'clsx'
import type { ReactionType } from '@civil/shared'

type PostReactionCounts = {
  maple?: number | null
  heart?: number | null
  haha?: number | null
  wow?: number | null
  sad?: number | null
  fire?: number | null
  total?: number | null
}

type ReactionOption = {
  key: 'maple' | 'heart' | 'haha' | 'sad' | 'wow'
  emoji: string
  label: string
}

const REACTION_OPTIONS: ReactionOption[] = [
  { key: 'maple', emoji: '👍', label: 'Like' },
  { key: 'heart', emoji: '❤️', label: 'Love' },
  { key: 'haha', emoji: '😂', label: 'Funny' },
  { key: 'sad', emoji: '😢', label: 'Cry' },
  { key: 'wow', emoji: '💡', label: 'Insightful' },
]

function normalizeViewerReaction(value: ReactionType | null | undefined): ReactionOption['key'] | null {
  if (!value) return null
  if (value === 'fire') return 'wow'
  if (value === 'maple' || value === 'heart' || value === 'haha' || value === 'sad' || value === 'wow') return value
  return null
}

function getReactionCount(counts: PostReactionCounts | undefined, key: ReactionOption['key']) {
  if (!counts) return 0
  if (key === 'wow') {
    return Number(counts.wow ?? 0) + Number(counts.fire ?? 0)
  }
  return Number(counts[key] ?? 0)
}

type PostReactionBarProps = {
  reactions?: PostReactionCounts
  viewerReaction?: ReactionType | null
  disabled?: boolean
  className?: string
  onReact?: (reaction: ReactionType | null) => void | Promise<void>
}

export default function PostReactionBar({
  reactions,
  viewerReaction,
  disabled = false,
  className,
  onReact,
}: PostReactionBarProps) {
  const activeReaction = normalizeViewerReaction(viewerReaction)
  const isDisabled = disabled || !onReact

  return (
    <div className={clsx('flex flex-wrap items-center gap-2', className)}>
      {REACTION_OPTIONS.map((option) => {
        const count = getReactionCount(reactions, option.key)
        const isActive = activeReaction === option.key
        const nextReaction: ReactionType | null = isActive ? null : option.key
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => void onReact?.(nextReaction)}
            disabled={isDisabled}
            className={clsx(
              'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition',
              isActive
                ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900',
              isDisabled && 'cursor-not-allowed opacity-70',
            )}
            aria-label={`${option.label} reaction`}
          >
            <span className="text-base leading-none" aria-hidden>{option.emoji}</span>
            {count > 0 ? (
              <span className={clsx('min-w-[1.25ch] text-center', isActive ? 'text-[var(--cc-primary)]' : 'text-slate-500')}>
                {count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
