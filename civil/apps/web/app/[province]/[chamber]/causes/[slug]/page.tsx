import type { Metadata } from 'next'
import ChamberPostPage from '../../../../c/[province]/[chamber]/posts/[slug]/page'
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
  return <ChamberPostPage params={params} />
}
