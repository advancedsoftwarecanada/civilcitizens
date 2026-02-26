'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { buildApiUrl } from '../../_lib/api'

type ForumPost = {
  id: string
  title?: string | null
  body?: string | null
  createdAt: string
  score?: number
  commentCount?: number
  author?: {
    handle: string
    name?: string | null
  }
}

export default function OrganizationForumClient({
  province,
  municipality,
  slug,
}: {
  province: string
  municipality: string
  slug: string
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [posts, setPosts] = useState<ForumPost[]>([])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ sort: 'new', limit: '100' })
        const res = await fetch(
          buildApiUrl(
            `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/posts?${params.toString()}`,
          ),
          { cache: 'no-store' },
        )
        if (!res.ok) {
          setError('Unable to load forum posts right now.')
          setPosts([])
          return
        }
        const payload = (await res.json().catch(() => null)) as { items?: ForumPost[] } | null
        setPosts(Array.isArray(payload?.items) ? payload.items : [])
      } catch (err) {
        console.error('Failed to load org forum posts', err)
        setError('Unable to load forum posts right now.')
        setPosts([])
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [municipality, province, slug])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return posts
    return posts.filter((post) => {
      const title = (post.title ?? '').toLowerCase()
      const body = (post.body ?? '').toLowerCase()
      const author = (post.author?.name ?? post.author?.handle ?? '').toLowerCase()
      return title.includes(q) || body.includes(q) || author.includes(q)
    })
  }, [posts, query])

  if (loading) return <p className="text-sm text-slate-500">Loading forum…</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search this organization"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-300"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Post</th>
              <th className="px-4 py-2 font-semibold">Author</th>
              <th className="px-4 py-2 font-semibold">Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={3}>
                  No posts found.
                </td>
              </tr>
            ) : (
              filtered.map((post) => (
                <tr key={post.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <Link href={`/post/${post.id}`} className="font-semibold text-slate-900 hover:text-[var(--cc-primary)] hover:underline">
                      {(post.title && post.title.trim()) || (post.body?.slice(0, 90) ?? 'Untitled post')}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-500">{post.commentCount ?? 0} comments</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{post.author?.name ?? `@${post.author?.handle ?? 'unknown'}`}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(post.createdAt).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
