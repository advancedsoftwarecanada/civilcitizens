import { normalizeHashtagSlug } from '@civil/shared'
import { notFound, redirect } from 'next/navigation'
import TopicPageClient from './TopicPageClient'

type PageProps = {
  params: {
    slug: string
  }
}

export default function TopicPage({ params }: PageProps) {
  const decodedSlug = decodeURIComponent(params.slug)
  const normalizedSlug = normalizeHashtagSlug(decodedSlug)
  if (!normalizedSlug) {
    notFound()
  }

  if (decodedSlug !== normalizedSlug) {
    redirect(`/t/${encodeURIComponent(normalizedSlug)}`)
  }

  return <TopicPageClient slug={normalizedSlug} />
}
