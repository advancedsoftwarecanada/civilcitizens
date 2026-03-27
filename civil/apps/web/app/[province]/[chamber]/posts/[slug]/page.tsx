import ChamberPostPageClient from '../../../../_components/ChamberPostPageClient'

type PageProps = {
  params: {
    province: string
    chamber: string
    slug: string
  }
}

export default function ProvinceChamberPostPage({ params }: PageProps) {
  return <ChamberPostPageClient params={params} />
}
