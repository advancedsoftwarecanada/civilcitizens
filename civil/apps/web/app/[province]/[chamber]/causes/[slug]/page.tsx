import type { Metadata } from 'next'
import ChamberPostPageClient from '../../../../c/[province]/[chamber]/posts/[slug]/ChamberPostPageClient'
import { generateCauseMetadata } from '../../../../_lib/causeMetadata'

type PageProps = {
  params: {
    province: string
    chamber: string
    slug: string
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return generateCauseMetadata({
    province: decodeURIComponent(params.province),
    chamber: decodeURIComponent(params.chamber),
    slug: decodeURIComponent(params.slug),
  })
}

export default function ProvinceChamberCausePage({ params }: PageProps) {
  return <ChamberPostPageClient params={params} />
}
