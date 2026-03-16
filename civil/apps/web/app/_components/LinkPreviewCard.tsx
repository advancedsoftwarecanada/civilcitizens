'use client'

import Link from 'next/link'

export type LinkPreviewRecord = {
  kind: string
  title: string
  description: string | null
  url: string
  imageUrl: string | null
  meta: string | null
}

type LinkPreviewCardProps = {
  preview: LinkPreviewRecord
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

export default function LinkPreviewCard({ preview, className }: LinkPreviewCardProps) {
  const targetUrl = (preview.url || '').trim()
  if (!targetUrl) return null

  const meta = splitPreviewMeta(preview.meta)
  const cardBody = (
    <div className={className ? className : 'w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:border-slate-300 hover:shadow-sm'}>
      {preview.imageUrl ? (
        <div className="relative aspect-[16/8] w-full overflow-hidden border-b border-slate-200 bg-slate-100">
          <img src={preview.imageUrl} alt={preview.title} className="h-full w-full object-cover" loading="lazy" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-black/5 to-transparent" />
          <div className="absolute left-3 top-3 rounded-full border border-white/45 bg-black/35 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
            {preview.kind === 'event'
              ? 'Event'
              : preview.kind === 'organization'
                ? 'Organization'
                : preview.kind === 'post'
                  ? 'Civil Link'
                  : 'Link'}
          </div>
        </div>
      ) : null}
      <div className="space-y-1.5 p-3">
        {meta.source ? <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">By {meta.source}</p> : null}
        <p className="line-clamp-2 break-words text-base font-semibold leading-tight text-slate-900">{preview.title}</p>
        {preview.description ? <p className="line-clamp-3 break-words text-sm leading-5 text-slate-600">{preview.description}</p> : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2 pt-0.5">
          {meta.detail ? (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              {meta.detail}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
            {targetUrl.startsWith('/') ? `civilcitizens.ca${targetUrl}` : targetUrl}
          </span>
        </div>
      </div>
    </div>
  )

  if (targetUrl.startsWith('/')) {
    return (
      <Link href={targetUrl} className="block w-full min-w-0 max-w-full" target="_blank" rel="noopener noreferrer">
        {cardBody}
      </Link>
    )
  }

  return (
    <a href={targetUrl} target="_blank" rel="noopener noreferrer" className="block w-full min-w-0 max-w-full">
      {cardBody}
    </a>
  )
}
