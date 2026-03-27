import ChamberPostPageClient from '../../../../../_components/ChamberPostPageClient'

type PageProps = {
  params: {
    province: string
    chamber: string
    slug: string
  }
}

export default function ChamberPostPage({ params }: PageProps) {
  return <ChamberPostPageClient params={params} />
}
