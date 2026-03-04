'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildApiUrl } from '../_lib/api'
import { extractCivilUrlsFromText } from '../_lib/civilLinks'

type LinkPreviewRecord = {
  kind: string
  title: string
  description: string | null
  url: string
  imageUrl: string | null
  meta: string | null
}

type LinkPreviewResponse = {
  preview?: LinkPreviewRecord | null
}

type CivilLinkPreviewListProps = {
  body?: string | null
  className?: string
}

function splitPreviewMeta(meta: string | null | undefined): { source: string | null; detail: string | null } {
  const raw = (meta ?? '').trim()
  if (!raw) return { source: null, detail: null }
  const parts = raw
    .split('•')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return { source: null, detail: null }
  return {
    source: parts[0] ?? null,
    detail: parts.slice(1).join(' • ') || null,
  }
}

export default function CivilLinkPreviewList({ body, className }: CivilLinkPreviewListProps) {
  const pendingUrlsRef = useRef<Set<string>>(new Set())
  const [previews, setPreviews] = useState<Record<string, LinkPreviewRecord | null>>({})
  const civilUrls = useMemo(() => extractCivilUrlsFromText(body ?? ''), [body])

  useEffect(() => {
    for (const url of civilUrls) {
      if (Object.prototype.hasOwnProperty.call(previews, url)) continue
      if (pendingUrlsRef.current.has(url)) continue
      pendingUrlsRef.current.add(url)

      void (async () => {
        try {
          const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
          const headers = token ? { authorization: `Bearer ${token}` } : undefined
          const response = await fetch(buildApiUrl(`/link-preview?url=${encodeURIComponent(url)}`), {
            headers,
            cache: 'no-store',
          })

          if (!response.ok) {
            setPreviews((prev) => (Object.prototype.hasOwnProperty.call(prev, url) ? prev : { ...prev, [url]: null }))
            return
          }

          const payload = (await response.json().catch(() => null)) as LinkPreviewResponse | null
          setPreviews((prev) => ({ ...prev, [url]: payload?.preview ?? null }))
        } catch {
          setPreviews((prev) => (Object.prototype.hasOwnProperty.call(prev, url) ? prev : { ...prev, [url]: null }))
        } finally {
          pendingUrlsRef.current.delete(url)
        }
      })()
    }
  }, [civilUrls, previews])

  const cards = civilUrls
    .map((url) => {
      const preview = previews[url]
      if (!preview) return null
      const targetUrl = (preview.url || '').trim() || url
      const meta = splitPreviewMeta(preview.meta)

      const cardBody = (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:border-slate-300 hover:shadow-sm">
          {preview.imageUrl ? (
            <div className="relative aspect-[16/8] w-full overflow-hidden border-b border-slate-200 bg-slate-100">
              <img src={preview.imageUrl} alt={preview.title} className="h-full w-full object-cover" loading="lazy" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-black/5 to-transparent" />
              <div className="absolute left-3 top-3 rounded-full border border-white/45 bg-black/35 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
                {preview.kind === 'event' ? 'Event' : preview.kind === 'organization' ? 'Organization' : 'Civil Link'}
              </div>
            </div>
          ) : null}
          <div className="space-y-1.5 p-3">
            {meta.source ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">By {meta.source}</p>
            ) : null}
            <p className="line-clamp-2 text-base font-semibold leading-tight text-slate-900">{preview.title}</p>
            {preview.description ? <p className="line-clamp-3 text-sm leading-5 text-slate-600">{preview.description}</p> : null}
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {meta.detail ? (
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  {meta.detail}
                </span>
              ) : null}
              <span className="truncate text-[11px] text-slate-500">
                {targetUrl.startsWith('/') ? `civilcitizens.ca${targetUrl}` : targetUrl}
              </span>
            </div>
          </div>
        </div>
      )

      if (targetUrl.startsWith('/')) {
        return (
          <Link key={`${url}-preview`} href={targetUrl} className="block">
            {cardBody}
          </Link>
        )
      }

      return (
        <a key={`${url}-preview`} href={targetUrl} target="_blank" rel="noopener noreferrer" className="block">
          {cardBody}
        </a>
      )
    })
    .filter((card): card is JSX.Element => Boolean(card))

  if (cards.length === 0) return null

  return <div className={className ? className : 'space-y-2'}>{cards}</div>
}
