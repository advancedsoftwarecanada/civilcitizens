"use client"

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Sidebar from '../../../../../_components/Sidebar'
import { JURISDICTION_LABELS, type ApiPost } from '../../../../../_components/PostComposer'
import { buildApiUrl } from '../../../../../_lib/api'
import { hasHomeChamber, type MeResponse } from '../../../../../_lib/me'
import { redirectToAuthModal } from '../../../../../_lib/authModal'

type Viewer = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
}

type CanonicalPaths = {
  user: string
  chamber: string | null
  legacy: string
}

type PageProps = {
  params: {
    province: string
    chamber: string
    slug: string
  }
}

function formatDateTime(iso: string) {
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

export default function ChamberPostPage({ params }: PageProps) {
  const provinceParam = decodeURIComponent(params.province)
  const chamberParam = decodeURIComponent(params.chamber)
  const slugParam = decodeURIComponent(params.slug)

  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [post, setPost] = useState<ApiPost | null>(null)
  const [paths, setPaths] = useState<CanonicalPaths | null>(null)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error' | 'not-found'>('loading')

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.pathname.startsWith('/c/')) {
      const target = `/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}/posts/${slugParam}`
      window.location.replace(target)
    }
  }, [chamberParam, provinceParam, slugParam])

  const loadViewer = useCallback(async () => {
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    try {
      const res = await fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } })
      if (!res.ok) {
        localStorage.removeItem('token')
        redirectToAuthModal('login')
        return
      }
      const data = (await res.json()) as MeResponse
      if (!hasHomeChamber(data)) {
        window.location.replace('/welcome')
        return
      }
      setViewer(data)
    } catch {
      localStorage.removeItem('token')
      redirectToAuthModal('login')
      /* noop */
    }
  }, [])

  const loadPost = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await fetch(`/api/posts/slug/${encodeURIComponent(slugParam)}`)
      if (!res.ok) {
        setStatus(res.status === 404 ? 'not-found' : 'error')
        return
      }
      const data = await res.json()
      const retrievedPost = data.post as ApiPost
      const canonical = data.paths as CanonicalPaths

      setPaths(canonical)

      const provinceMatches = retrievedPost.provinceCode?.toLowerCase() === provinceParam.toLowerCase()
      const chamberMatches = retrievedPost.chamberSlug?.toLowerCase() === chamberParam.toLowerCase()

      if (!provinceMatches || !chamberMatches) {
        if (canonical?.chamber) {
          window.location.replace(canonical.chamber)
          return
        }
      }

      setPost(retrievedPost)
      setStatus('loaded')
    } catch (err) {
      console.error('Failed loading post', err)
      setStatus('error')
    }
  }, [chamberParam, provinceParam, slugParam])

  useEffect(() => {
    loadViewer().catch(() => {
      /* noop */
    })
  }, [loadViewer])

  useEffect(() => {
    loadPost().catch(() => {
      /* noop */
    })
  }, [loadPost])

  return (
    <div className="w-full">
      <div className="border-b bg-white py-4 shadow-sm lg:hidden">
        <div className="mx-auto max-w-7xl px-4">
          <Sidebar me={viewer ?? undefined} active="chambers" />
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-7xl grid-cols-12 gap-6 px-4 py-6">
        <Sidebar me={viewer ?? undefined} active="chambers" />

        <main className="col-span-12 space-y-6 md:col-span-9 lg:col-span-6">
          {status === 'loading' ? (
            <div className="rounded border bg-white p-6 text-sm text-gray-500 shadow-sm">Loading post…</div>
          ) : status === 'not-found' ? (
            <div className="rounded border bg-white p-6 text-sm text-gray-500 shadow-sm">Post not found.</div>
          ) : status === 'error' ? (
            <div className="rounded border bg-white p-6 text-sm text-red-600 shadow-sm">Unable to load this post right now.</div>
          ) : post ? (
            <article className="rounded border bg-white p-6 shadow-sm">
              <nav className="mb-4 text-xs text-gray-500">
                <Link href="/home" className="hover:underline">
                  Home
                </Link>
                <span className="mx-1">/</span>
                <Link href={`/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`} className="hover:underline">
                  Chamber feed
                </Link>
                <span className="mx-1">/</span>
                <Link href={`/u/${post.author.handle}`} className="hover:underline">
                  @{post.author.handle}
                </Link>
              </nav>

              <header className="flex items-start gap-3">
                <div className="h-12 w-12 overflow-hidden rounded-full bg-gray-200">
                  {post.author.avatarUrl ? (
                    <Image
                      src={post.author.avatarUrl}
                      alt={post.author.name ?? post.author.handle}
                      width={48}
                      height={48}
                      unoptimized
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-gray-600">
                      {(post.author.name || post.author.handle).substring(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
                    <Link href={`/u/${post.author.handle}`} className="font-semibold text-gray-900 hover:underline">
                      {post.author.name ?? post.author.handle}
                    </Link>
                    <span>@{post.author.handle}</span>
                    <span className="text-xs">• {formatDateTime(post.createdAt)}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                      {JURISDICTION_LABELS[post.jurisdiction]}
                    </span>
                    {post.provinceCode && post.chamberSlug ? (
                      <Link
                        href={`/${post.provinceCode.toLowerCase()}/${post.chamberSlug.toLowerCase()}`}
                        className="rounded-full border border-gray-200 px-2 py-0.5 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50"
                      >
                        {post.chamberName ?? post.chamberSlug}
                      </Link>
                    ) : null}
                  </div>
                  <div className="mt-4 space-y-4 text-[16px] leading-7 text-gray-900">
                    {post.type === 'article' && post.title ? (
                      <h1 className="text-2xl font-semibold text-gray-900">{post.title}</h1>
                    ) : null}
                    {post.type === 'article' ? (
                      <div className="prose prose-base max-w-none" dangerouslySetInnerHTML={{ __html: post.body }} />
                    ) : (
                      <div className="whitespace-pre-wrap">{post.body}</div>
                    )}
                  </div>
                </div>
              </header>

              <footer className="mt-6 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                {post.counts ? (
                  <span>{post.counts.likes} likes • {post.counts.comments} comments</span>
                ) : null}
                <span>Canonical: {paths?.chamber ?? buildLegacyPath(post)}</span>
              </footer>
            </article>
          ) : null}
        </main>

        <aside className="col-span-3 hidden lg:block">
          <div className="sticky top-4 space-y-4">
            <div className="rounded border bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-gray-900">Keep exploring</div>
              <p className="mt-2 text-sm text-gray-600">
                Jump back to the chamber feed or browse neighbouring ridings to see how other citizens are weighing in.
              </p>
              <Link
                href={`/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`}
                className="mt-3 inline-flex items-center justify-center rounded bg-[var(--cc-primary)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--cc-primary-700)]"
              >
                Return to chamber
              </Link>
            </div>
            <div className="rounded border bg-white p-4 shadow-sm text-sm text-gray-600">
              Share thoughtful updates and tag your chamber to reach neighbours faster. Articles support full formatting for
              deeper dives.
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function buildLegacyPath(post: ApiPost) {
  return `/post/${post.id}`
}
