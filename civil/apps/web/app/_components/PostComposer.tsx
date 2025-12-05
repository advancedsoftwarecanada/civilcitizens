'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import RichTextEditor from './RichTextEditor'
import clsx from 'clsx'
import type { Jurisdiction } from '@civil/shared'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildApiUrl } from '../_lib/api'

export type PostType = 'post' | 'article'

export type ApiPost = {
  id: string
  seoSlug: string | null
  type: PostType
  title?: string | null
  body: string
  mediaUrl?: string | null
  createdAt: string
  updatedAt: string
  jurisdiction: Jurisdiction
  provinceCode?: string | null
  provinceName?: string | null
  chamberSlug?: string | null
  chamberName?: string | null
  author: {
    id: string
    handle: string
    name?: string | null
    avatarUrl?: string | null
    isPremium?: boolean
    isVerified?: boolean
  }
  counts?: {
    upvotes: number
    downvotes: number
    score: number
    commentCount: number
  }
  metrics?: {
    hotScore: number
  }
  viewer?: {
    vote: number | null
  }
}

type ChamberTarget = {
  provinceCode: string
  chamberSlug: string
  chamberName?: string | null
  provinceName?: string | null
}

type PostComposerProps = {
  me?: {
    id: string
    handle: string
    name?: string | null
    avatarUrl?: string | null
  } | null
  className?: string
  defaultPostType?: PostType
  chamberTarget?: ChamberTarget | null
  onPostCreated?: (post: ApiPost) => void
  variant?: 'card' | 'plain'
}

const MAX_POST_LENGTH = 5000
const MIN_ARTICLE_TITLE_LENGTH = 3
const MIN_ARTICLE_BODY_LENGTH = 100

export const JURISDICTION_LABELS: Record<Jurisdiction, string> = {
  citizen: 'Citizen',
  municipal: 'Municipal',
  provincial: 'Provincial',
  federal: 'Federal',
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
}

export default function PostComposer({
  className,
  defaultPostType = 'post',
  chamberTarget = null,
  onPostCreated,
  variant = 'card',
}: PostComposerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [postType, setPostType] = useState<PostType>(defaultPostType)
  const [draft, setDraft] = useState('')
  const [articleTitle, setArticleTitle] = useState('')
  const [articleBody, setArticleBody] = useState('<p></p>')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const jurisdiction: Jurisdiction = 'citizen'

  const articleBodyPlain = useMemo(() => stripHtml(articleBody), [articleBody])

  const canSubmit = useMemo(() => {
    if (postType === 'post') {
      const trimmed = draft.trim()
      return trimmed.length > 0 && trimmed.length <= MAX_POST_LENGTH
    }

    const titleOk = articleTitle.trim().length >= MIN_ARTICLE_TITLE_LENGTH
    const bodyOk = articleBodyPlain.length >= MIN_ARTICLE_BODY_LENGTH
    return titleOk && bodyOk
  }, [articleBodyPlain, articleTitle, draft, postType])

  const resetComposer = useCallback(() => {
    setDraft('')
    setArticleTitle('')
    setArticleBody('<p></p>')
    setPostType(defaultPostType)
    setError(null)
  }, [defaultPostType])

  const submitPost = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!canSubmit || submitting) return

    setSubmitting(true)
    setError(null)

    try {
      const payload: Record<string, unknown> =
        postType === 'post'
          ? { type: 'post', body: draft }
          : { type: 'article', title: articleTitle.trim(), body: articleBody }

      if (chamberTarget) {
        payload.chamberProvince = chamberTarget.provinceCode
        payload.chamberSlug = chamberTarget.chamberSlug
      }

      payload.jurisdiction = jurisdiction

  const res = await fetch(buildApiUrl('/posts'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)

        const normalizeError = (value: unknown): string | null => {
          if (!value) return null
          if (typeof value === 'string') return value
          if (Array.isArray(value)) {
            const joined = value.map((item) => normalizeError(item)).filter(Boolean).join(' ')
            return joined.length ? joined : null
          }
          if (typeof value === 'object') {
            const parts = Object.values(value as Record<string, unknown>)
            const joined = parts.map((item) => normalizeError(item)).filter(Boolean).join(' ')
            return joined.length ? joined : null
          }
          return String(value)
        }

        const friendlyError = normalizeError((data as any)?.error) ?? normalizeError((data as any)?.message)
        setError(friendlyError ?? 'Unable to publish right now. Please try again.')
        return
      }

      const post = (await res.json()) as ApiPost
      onPostCreated?.(post)
      resetComposer()
    } finally {
      setSubmitting(false)
    }
  }, [articleBody, articleTitle, canSubmit, chamberTarget, draft, jurisdiction, onPostCreated, postType, resetComposer, submitting])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return
      if (!(event.ctrlKey || event.metaKey)) return
      if (!containerRef.current) return
      const target = event.target as Node | null
      if (!target || !containerRef.current.contains(target)) return
      if (!canSubmit || submitting) return
      event.preventDefault()
      void submitPost()
    }

    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('keydown', handleKeydown)
    }
  }, [canSubmit, submitPost, submitting])

  const containerClasses = clsx(
    'flex flex-col gap-4',
    variant === 'card' ? 'surface-card px-6 py-5 shadow-panel' : '',
    className,
  )

  return (
    <section ref={containerRef} className={containerClasses}>
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Share something new</p>
          <h2 className="text-lg font-semibold text-slate-900">What&apos;s happening in your chamber?</h2>
          <p className="text-sm text-slate-500">Toggle between quick updates and long-form articles whenever inspiration hits.</p>
          {chamberTarget ? (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600">
              <span>Posting to</span>
              <span className="text-slate-900">{chamberTarget.chamberName ?? chamberTarget.chamberSlug}</span>
              <span className="uppercase tracking-wide text-slate-400">{chamberTarget.provinceCode}</span>
            </div>
          ) : null}
        </div>
        <div className="inline-flex rounded-full bg-slate-100 p-1 text-sm font-semibold text-slate-500">
          <button
            type="button"
            className={clsx(
              'rounded-full px-4 py-1 transition',
              postType === 'post' ? 'bg-white text-[var(--cc-primary)] shadow-subtle' : 'text-slate-500',
            )}
            onClick={() => setPostType('post')}
            disabled={submitting}
          >
            Post
          </button>
          <button
            type="button"
            className={clsx(
              'rounded-full px-4 py-1 transition',
              postType === 'article' ? 'bg-white text-[var(--cc-primary)] shadow-subtle' : 'text-slate-500',
            )}
            onClick={() => setPostType('article')}
            disabled={submitting}
          >
            Article
          </button>
        </div>
      </header>

      <div className="space-y-4">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {postType === 'post' ? (
          <div className="space-y-2">
            <textarea
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base leading-6 text-slate-800 placeholder:text-slate-400 focus:border-[var(--cc-primary)] focus:bg-white focus:outline-none focus:ring-0"
              placeholder="Share a quick update, poll, or question"
              rows={4}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_POST_LENGTH}
              disabled={submitting}
            />
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Quick thoughts shine here.</span>
              <span>{draft.trim().length}/{MAX_POST_LENGTH}</span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-semibold text-slate-600" htmlFor="article-title">
                Headline
              </label>
              <input
                id="article-title"
                type="text"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 shadow-inner"
                placeholder="Give readers a headline"
                value={articleTitle}
                onChange={(e) => setArticleTitle(e.target.value)}
                maxLength={160}
                disabled={submitting}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-600">Story</label>
              <RichTextEditor
                value={articleBody}
                onChange={setArticleBody}
                placeholder="Share a deeper dive, context, or long-form perspective..."
                minHeight={260}
                disabled={submitting}
              />
              <div className="mt-1 flex justify-between text-xs text-slate-500">
                <span>Articles support rich formatting powered by Summernote.</span>
                <span>{articleBodyPlain.length}/10000</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-full px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-900"
            onClick={resetComposer}
            disabled={submitting}
          >
            Clear
          </button>
          <button
            className="rounded-full bg-[var(--cc-primary)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-slate-400"
            onClick={submitPost}
            disabled={!canSubmit || submitting}
          >
            {submitting ? 'Publishing…' : postType === 'article' ? 'Publish article' : 'Post'}
          </button>
        </div>
      </div>
    </section>
  )
}
