'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { buildApiUrl } from '../_lib/api'
import { extractCivilUrlsFromText } from '../_lib/civilLinks'
import LinkPreviewCard, { type LinkPreviewRecord } from './LinkPreviewCard'

type LinkPreviewResponse = {
  preview?: LinkPreviewRecord | null
}

type CivilLinkPreviewListProps = {
  body?: string | null
  className?: string
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
      return <LinkPreviewCard key={`${url}-preview`} preview={preview} />
    })
    .filter((card): card is JSX.Element => Boolean(card))

  if (cards.length === 0) return null

  return <div className={className ? className : 'w-full min-w-0 max-w-full space-y-2'}>{cards}</div>
}
