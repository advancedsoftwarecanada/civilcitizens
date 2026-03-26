"use client"

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { ApiPost } from '../../../../../../_components/PostComposer'
import CivilCard from '../../../../../../_components/CivilCard'
import DashboardShell from '../../../../../../_components/DashboardShell'
import { buildApiUrl } from '../../../../../../_lib/api'
import { formatUserDisplayName } from '../../../../../../_lib/text'

type PageProps = {
  params: {
    province: string
    chamber: string
    slug: string
  }
}

type CauseContributorItem = {
  id: string
  amountCents: number
  createdAt: string
  sourceType: string
  user: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl: string | null
    isPremium: boolean
    isVerified: boolean
  }
}

function formatCurrency(amountCents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(amountCents / 100)
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

export default function CauseContributorsPage({ params }: PageProps) {
  const provinceParam = decodeURIComponent(params.province)
  const chamberParam = decodeURIComponent(params.chamber)
  const slugParam = decodeURIComponent(params.slug)
  const causeHref = useMemo(() => `/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}/causes/${slugParam}`, [chamberParam, provinceParam, slugParam])

  const [status, setStatus] = useState<'loading' | 'loaded' | 'not-found' | 'error'>('loading')
  const [post, setPost] = useState<ApiPost | null>(null)
  const [contributors, setContributors] = useState<CauseContributorItem[]>([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setStatus('loading')

      try {
        const postRes = await fetch(`/api/posts/slug/${encodeURIComponent(slugParam)}`)
        if (!postRes.ok) {
          if (!cancelled) setStatus(postRes.status === 404 ? 'not-found' : 'error')
          return
        }

        const payload = (await postRes.json().catch(() => null)) as { post?: ApiPost } | null
        const loadedPost = payload?.post ?? null
        if (!loadedPost || loadedPost.type !== 'cause') {
          if (!cancelled) setStatus('not-found')
          return
        }

        const contributorsRes = await fetch(buildApiUrl(`/causes/posts/${encodeURIComponent(loadedPost.id)}/contributors?limit=250`), {
          cache: 'no-store',
        })
        if (!contributorsRes.ok) {
          if (!cancelled) {
            setPost(loadedPost)
            setContributors([])
            setStatus('error')
          }
          return
        }

        const contributorsPayload = (await contributorsRes.json().catch(() => null)) as { items?: CauseContributorItem[] } | null
        if (!cancelled) {
          setPost(loadedPost)
          setContributors(Array.isArray(contributorsPayload?.items) ? contributorsPayload.items : [])
          setStatus('loaded')
        }
      } catch {
        if (!cancelled) setStatus('error')
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [slugParam])

  return (
    <DashboardShell mainClassName="space-y-6 pb-12">
      {status === 'loading' ? <div className="rounded border bg-white p-6 text-sm text-gray-500 shadow-sm">Loading contributors…</div> : null}
      {status === 'not-found' ? <div className="rounded border bg-white p-6 text-sm text-gray-500 shadow-sm">Cause not found.</div> : null}
      {status === 'error' ? <div className="rounded border bg-white p-6 text-sm text-red-600 shadow-sm">Unable to load contributors right now.</div> : null}

      {status === 'loaded' ? (
        <section className="space-y-4 rounded border bg-white p-6 shadow-sm">
          <nav className="text-xs text-gray-500">
            <Link href="/home" className="hover:underline">Home</Link>
            <span className="mx-1">/</span>
            <Link href={`/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`} className="hover:underline">
              {post?.communityName ?? chamberParam}
            </Link>
            <span className="mx-1">/</span>
            <Link href={causeHref} className="hover:underline">{post?.title?.trim() || 'Cause'}</Link>
            <span className="mx-1">/</span>
            <span className="text-gray-700">Contributors</span>
          </nav>

          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Contributors</h1>
              <p className="mt-1 text-sm text-slate-500">{contributors.length ? `${contributors.length.toLocaleString()} recent contributions` : 'No contributions yet.'}</p>
            </div>
            <Link href={causeHref} className="text-sm font-semibold text-[var(--cc-primary)] hover:underline">Back to cause</Link>
          </div>

          {contributors.length ? (
            <ul className="space-y-3">
              {contributors.map((entry) => {
                const displayName = formatUserDisplayName(entry.user.name, entry.user.handle) || entry.user.handle
                return (
                  <li key={entry.id}>
                    <CivilCard
                      href={`/u/${entry.user.handle}`}
                      size="md"
                      name={displayName}
                      avatarAlt={displayName}
                      avatarInitials={displayName}
                      avatarSrc={entry.user.avatarUrl}
                      coverUrl={entry.user.coverUrl}
                      subtitle={`@${entry.user.handle}`}
                      details={`${formatCurrency(entry.amountCents)} • ${formatDateTime(entry.createdAt)}`}
                      isVerified={entry.user.isVerified}
                      isBusiness={entry.user.isPremium}
                    />
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="rounded border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No one has backed this cause yet.
            </div>
          )}
        </section>
      ) : null}
    </DashboardShell>
  )
}