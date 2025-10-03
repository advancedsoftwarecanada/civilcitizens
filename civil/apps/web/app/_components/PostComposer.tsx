'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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

const JURISDICTION_OPTIONS: Array<{ value: Jurisdiction; label: string }> = [
  { value: 'citizen', label: JURISDICTION_LABELS.citizen },
  { value: 'municipal', label: JURISDICTION_LABELS.municipal },
  { value: 'provincial', label: JURISDICTION_LABELS.provincial },
  { value: 'federal', label: JURISDICTION_LABELS.federal },
]

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
}

export default function PostComposer({
  className,
  defaultPostType = 'post',
  chamberTarget = null,
  onPostCreated,
}: PostComposerProps) {
  const [postType, setPostType] = useState<PostType>(defaultPostType)
  const [draft, setDraft] = useState('')
  const [articleTitle, setArticleTitle] = useState('')
  const [articleBody, setArticleBody] = useState('<p></p>')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const defaultJurisdiction: Jurisdiction = 'citizen'
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>(defaultJurisdiction)

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
    setJurisdiction(defaultJurisdiction)
  }, [defaultJurisdiction, defaultPostType])

  useEffect(() => {
    setJurisdiction(defaultJurisdiction)
  }, [chamberTarget, defaultJurisdiction])

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

  return (
    <section className={clsx('border border-gray-200 bg-white px-5 py-4', className)}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Share something new</h2>
          <p className="text-xs text-gray-500">
            Toggle between quick updates and long-form articles whenever you&apos;re inspired.
          </p>
          {chamberTarget ? (
            <div className="mt-2 inline-flex items-center gap-1 border border-gray-200 bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-700">
              <span>Posting to</span>
              <span className="font-semibold">{chamberTarget.chamberName ?? chamberTarget.chamberSlug}</span>
              <span className="uppercase tracking-wide text-gray-500">{chamberTarget.provinceCode}</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-4 text-sm">
          <button
            type="button"
            className={clsx(
              'pb-2 text-sm font-semibold transition-colors',
              postType === 'post'
                ? 'border-b-2 border-[var(--cc-primary)] text-[var(--cc-primary)]'
                : 'text-gray-400 hover:text-[var(--cc-primary)]',
            )}
            onClick={() => setPostType('post')}
            disabled={submitting}
          >
            Post
          </button>
          <button
            type="button"
            className={clsx(
              'pb-2 text-sm font-semibold transition-colors',
              postType === 'article'
                ? 'border-b-2 border-[var(--cc-primary)] text-[var(--cc-primary)]'
                : 'text-gray-400 hover:text-[var(--cc-primary)]',
            )}
            onClick={() => setPostType('article')}
            disabled={submitting}
          >
            Article
          </button>
        </div>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs font-medium text-gray-500">
        <span className="uppercase tracking-wide text-gray-400">Tag</span>
        {JURISDICTION_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={clsx(
              'pb-1 text-xs font-semibold uppercase tracking-widest transition',
              jurisdiction === option.value
                ? 'border-b-2 border-[var(--cc-primary)] text-[var(--cc-primary)]'
                : 'text-gray-400 hover:text-[var(--cc-primary)]'
            )}
            onClick={() => setJurisdiction(option.value)}
            disabled={submitting}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {postType === 'post' ? (
          <div className="space-y-2">
            <textarea
              className="w-full rounded-none border border-gray-200 px-3 py-3 text-[15px] leading-6 focus:border-[var(--cc-primary)] focus:outline-none focus:ring-0"
              placeholder="What&apos;s happening?"
              rows={4}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_POST_LENGTH}
              disabled={submitting}
            />
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>Quick thoughts, polls, and reactions shine here.</span>
              <span>
                {draft.trim().length}/{MAX_POST_LENGTH}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="article-title">
                Headline
              </label>
              <input
                id="article-title"
                type="text"
                className="mt-1 w-full rounded-none border border-gray-300 px-3 py-2"
                placeholder="Give readers a headline"
                value={articleTitle}
                onChange={(e) => setArticleTitle(e.target.value)}
                maxLength={160}
                disabled={submitting}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Story</label>
              <RichTextEditor
                value={articleBody}
                onChange={setArticleBody}
                placeholder="Share a deeper dive, context, or long-form perspective..."
                minHeight={260}
                disabled={submitting}
              />
              <div className="mt-1 flex justify-between text-xs text-gray-500">
                <span>Articles support rich formatting powered by Summernote.</span>
                <span>{articleBodyPlain.length}/10000</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
            onClick={resetComposer}
            disabled={submitting}
          >
            Clear
          </button>
          <button
            className="rounded bg-[var(--cc-primary)] px-4 py-2 text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-gray-400"
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
