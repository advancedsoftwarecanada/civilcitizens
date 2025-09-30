"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Sidebar from '../_components/Sidebar'
import RichTextEditor from '../_components/RichTextEditor'

type User = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
}

type Post = {
  id: string
  body: string
  createdAt: string
  author: User
  type: 'post' | 'article'
  title?: string | null
}

const MAX_POST_LENGTH = 5000
const MIN_ARTICLE_TITLE_LENGTH = 3
const MIN_ARTICLE_BODY_LENGTH = 100

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function formatDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function initialsFromUser(user: User) {
  const source = user.name || user.handle
  return source
    .split(' ')
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2)
}

export default function HomePage() {
  const [me, setMe] = useState<User | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [postType, setPostType] = useState<'post' | 'article'>('post')
  const [draft, setDraft] = useState('')
  const [articleTitle, setArticleTitle] = useState('')
  const [articleBody, setArticleBody] = useState('<p></p>')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshPosts = useCallback(async () => {
    const response = await fetch('/api/posts')
    const data = await response.json().catch(() => ({ items: [] }))
    setPosts(data.items ?? [])
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      window.location.href = '/login'
      return
    }

    fetch('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject('unauthorized')))
      .then(setMe)
      .catch(() => {
        localStorage.removeItem('token')
        window.location.href = '/login'
      })

    refreshPosts().catch(() => {
      /* noop */
    })
  }, [refreshPosts])

  const articleBodyPlain = useMemo(() => stripHtml(articleBody), [articleBody])

  const canSubmit = useMemo(() => {
    if (postType === 'post') {
      const trimmed = draft.trim()
      return trimmed.length > 0 && trimmed.length <= MAX_POST_LENGTH
    }

    const titleOk = articleTitle.trim().length >= MIN_ARTICLE_TITLE_LENGTH
    const bodyOk = articleBodyPlain.length >= MIN_ARTICLE_BODY_LENGTH
    return titleOk && bodyOk
  }, [postType, draft, articleTitle, articleBodyPlain])

  const resetComposer = useCallback(() => {
    setDraft('')
    setArticleTitle('')
    setArticleBody('<p></p>')
    setPostType('post')
  }, [])

  const submitPost = useCallback(async () => {
    const token = localStorage.getItem('token')
    if (!token) {
      window.location.href = '/login'
      return
    }
    if (!canSubmit || submitting) return

    setSubmitting(true)
    setError(null)
    try {
      const payload =
        postType === 'post'
          ? { type: 'post', body: draft }
          : { type: 'article', title: articleTitle.trim(), body: articleBody }

      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.message ?? 'Unable to publish right now. Please try again.')
        return
      }

      resetComposer()
      await refreshPosts()
    } finally {
      setSubmitting(false)
    }
  }, [articleBody, articleTitle, canSubmit, draft, postType, refreshPosts, resetComposer, submitting])

  return (
    <div className="w-full">
      <div className="border-b bg-white py-4 shadow-sm lg:hidden">
        <div className="mx-auto max-w-6xl px-4">
          <Sidebar me={me ?? undefined} active="home" />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-6xl gap-6 px-4 py-6">
        <aside className="hidden w-72 shrink-0 lg:block">
          <Sidebar me={me ?? undefined} active="home" />
        </aside>

        <main className="flex-1 space-y-6">
          <section className="rounded border bg-white p-6 shadow-sm">
            <header className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Share something new</h2>
                <p className="text-sm text-gray-500">
                  Toggle between quick updates and long-form articles whenever you&apos;re inspired.
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  className={`rounded-full px-4 py-1 font-medium transition-colors ${
                    postType === 'post' ? 'bg-black text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                  onClick={() => setPostType('post')}
                  disabled={submitting}
                >
                  Post
                </button>
                <button
                  type="button"
                  className={`rounded-full px-4 py-1 font-medium transition-colors ${
                    postType === 'article' ? 'bg-black text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                  onClick={() => setPostType('article')}
                  disabled={submitting}
                >
                  Article
                </button>
              </div>
            </header>

            <div className="mt-5 space-y-4">
              {error ? <p className="text-sm text-red-600">{error}</p> : null}

              {postType === 'post' ? (
                <div className="space-y-2">
                  <textarea
                    className="w-full rounded border px-3 py-2 text-[15px] leading-6"
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
                      className="mt-1 w-full rounded border px-3 py-2"
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
                  className="rounded px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
                  onClick={resetComposer}
                  disabled={submitting}
                >
                  Clear
                </button>
                <button
                  className="rounded bg-black px-4 py-2 text-white transition disabled:cursor-not-allowed disabled:bg-gray-400"
                  onClick={() => submitPost()}
                  disabled={!canSubmit || submitting}
                >
                  {submitting ? 'Publishing…' : postType === 'article' ? 'Publish article' : 'Post'}
                </button>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            {posts.length === 0 ? (
              <div className="rounded border bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
                No updates yet. Once the community starts posting, you&apos;ll see them here.
              </div>
            ) : (
              posts.map((p) => (
                <article key={p.id} className="rounded border bg-white p-6 shadow-sm">
                  <header className="flex items-start gap-3">
                    <div className="h-11 w-11 overflow-hidden rounded-full bg-gray-200">
                      {p.author.avatarUrl ? (
                        <img src={p.author.avatarUrl} alt={p.author.name ?? p.author.handle} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-gray-600">
                          {initialsFromUser(p.author) || 'CC'}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
                        <span className="font-semibold text-gray-900">{p.author.name ?? p.author.handle}</span>
                        <span>@{p.author.handle}</span>
                        <span className="text-xs">• {formatDate(p.createdAt)}</span>
                      </div>
                      <div className="mt-3 space-y-3 text-[15px] leading-6 text-gray-800">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
                          <span className="rounded-full border border-gray-300 px-2 py-0.5">
                            {p.type === 'article' ? 'Article' : 'Post'}
                          </span>
                          {p.type === 'article' && p.title ? (
                            <span className="font-semibold text-gray-700">{p.title}</span>
                          ) : null}
                        </div>
                        {p.type === 'article' ? (
                          <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: p.body }} />
                        ) : (
                          <div className="whitespace-pre-wrap">{p.body}</div>
                        )}
                      </div>
                    </div>
                  </header>
                </article>
              ))
            )}
          </section>
        </main>

        <aside className="hidden w-80 shrink-0 space-y-4 xl:block">
          <div className="rounded border bg-white p-4 shadow-sm">
            <div className="border-b pb-3 text-sm font-semibold">For you</div>
            <p className="pt-3 text-sm text-gray-500">
              We&apos;ll recommend chambers and citizens to follow as this feed comes to life.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
