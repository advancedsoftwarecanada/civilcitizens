import type { Metadata } from 'next'
import { generateCauseMetadata } from '../../../../_lib/causeMetadata'

type LayoutProps = {
  children: React.ReactNode
  params: {
    province: string
    chamber: string
    slug: string
  }
}

export async function generateMetadata({ params }: Omit<LayoutProps, 'children'>): Promise<Metadata> {
  return generateCauseMetadata({
    province: decodeURIComponent(params.province),
    chamber: decodeURIComponent(params.chamber),
    slug: decodeURIComponent(params.slug),
  })
}

export default function ProvinceChamberCauseLayout({ children }: LayoutProps) {
  return children
}
