"use client"

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Sidebar from '../../../../_components/Sidebar'
import { RightRail } from '../../../../_components/RightRail'
import { JURISDICTION_LABELS, type ApiPost } from '../../../../_components/PostComposer'

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
    handle: string
    slug: string
  }
}

function formatDateTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function UserPostPage({ params }: PageProps) {
  const handleParam = decodeURIComponent(params.handle)
  const slugParam = decodeURIComponent(params.slug)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [post, setPost] = useState<ApiPost | null>(null)
  const [paths, setPaths] = useState<CanonicalPaths | null>(null)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error' | 'not-found'>('loading')

  const loadViewer = useCallback(async () => {
    const token = localStorage.getItem('token')
    if (!token) return
    try {
      const res = await fetch('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setViewer(data)
    } catch {
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

      if (retrievedPost.author.handle.toLowerCase() !== handleParam.toLowerCase()) {
        if (canonical?.user) {
          window.location.replace(canonical.user)
          return
        }
      }

      setPost(retrievedPost)
      setStatus('loaded')
    } catch (err) {
      console.error('Failed loading post', err)
      setStatus('error')
    }
  }, [handleParam, slugParam])

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
        <div className="mx-auto max-w-6xl px-4">
          <Sidebar me={viewer ?? undefined} active="home" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 pb-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)_220px] lg:gap-0 xl:max-w-6xl xl:grid-cols-[240px_minmax(0,1fr)_260px] xl:gap-0">
        <Sidebar me={viewer ?? undefined} active="home" />

        <main className="space-y-6 lg:min-h-[calc(100vh-48px)] lg:px-0">
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
                <Link href={`/u/${post.author.handle}`} className="hover:underline">
                  @{post.author.handle}
                </Link>
                {paths?.chamber ? (
                  <>
                    <span className="mx-1">/</span>
                    <Link href={paths.chamber} className="hover:underline">
                      {post.chamberName ?? post.chamberSlug}
                    </Link>
                  </>
                ) : null}
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
                <span>Canonical: {paths?.user ?? buildLegacyPath(post)}</span>
              </footer>
            </article>
          ) : null}
        </main>

        <aside className="hidden lg:flex lg:min-h-[calc(100vh-48px)] lg:w-[220px] lg:flex-col lg:border-l lg:border-gray-200 lg:bg-white xl:w-[260px]">
          <RightRail />
        </aside>
      </div>
    </div>
  )
}

function buildLegacyPath(post: ApiPost) {
  return `/post/${post.id}`
}
