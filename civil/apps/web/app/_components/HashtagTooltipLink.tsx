'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import TopicFollowButton from './TopicFollowButton'
import { buildApiUrl } from '../_lib/api'

type HashtagTooltipLinkProps = {
  slug: string
  text: string
  href: string
  className: string
}

type TopicSummaryPayload = {
  slug: string
  href: string
  following: boolean
  followingCount: number
  postsLast30Days: number
  postsTotal: number
}

function formatCountLabel(value: number, noun: string, suffix?: string) {
  const base = `${value.toLocaleString()} ${noun}`
  return suffix ? `${base} ${suffix}` : base
}

export default function HashtagTooltipLink({ slug, text, href, className }: HashtagTooltipLinkProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<TopicSummaryPayload | null>(null)
  const [following, setFollowing] = useState(false)
  const containerRef = useRef<HTMLSpanElement | null>(null)

  const loadSummary = useCallback(async () => {
    setLoading(true)
    try {
      const token = typeof window === 'undefined' ? null : window.localStorage.getItem('token')
      const response = await fetch(buildApiUrl(`/topics/${encodeURIComponent(slug)}/summary`), {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      })
      if (!response.ok) {
        setSummary(null)
        return
      }
      const payload = (await response.json().catch(() => null)) as TopicSummaryPayload | null
      if (!payload) {
        setSummary(null)
        return
      }
      setSummary(payload)
      setFollowing(Boolean(payload.following))
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    if (!open) return
    void loadSummary()
  }, [loadSummary, open])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (containerRef.current?.contains(target)) return
      setOpen(false)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <span ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={className}
      >
        {text}
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-2 w-[18rem] rounded-3xl border border-slate-200 bg-white p-4 text-left shadow-[0_24px_60px_rgba(15,23,42,0.16)]">
          <div className="space-y-3">
            <div>
              <Link href={href} className="text-sm font-semibold text-[var(--cc-primary)] hover:text-[var(--cc-primary)]/85" onClick={() => setOpen(false)}>
                {text}
              </Link>
            </div>

            <div>
              <TopicFollowButton
                slug={slug}
                initialFollowing={following}
                size="sm"
                onChange={(nextFollowing) => {
                  setFollowing(nextFollowing)
                  setSummary((current) =>
                    current
                      ? {
                          ...current,
                          following: nextFollowing,
                          followingCount: Math.max(0, current.followingCount + (nextFollowing ? 1 : -1)),
                        }
                      : current,
                  )
                }}
                className="w-full"
              />
            </div>

            {loading ? (
              <p className="text-xs text-slate-500">Loading hashtag details…</p>
            ) : summary ? (
              <div className="space-y-1 text-xs text-slate-600">
                <p>{formatCountLabel(summary.followingCount, 'Following')}</p>
                <p>{formatCountLabel(summary.postsLast30Days, 'Posts', 'in the last 30 days')}</p>
                <p>{formatCountLabel(summary.postsTotal, 'Posts', 'total')}</p>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Unable to load hashtag details.</p>
            )}
          </div>
        </div>
      ) : null}
    </span>
  )
}