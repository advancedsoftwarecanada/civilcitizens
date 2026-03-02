import OrganizationJobDetailClient from './OrganizationJobDetailClient'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
    jobId: string
  }
}

export default function OrganizationJobDetailPage({ params }: PageProps) {
  return <OrganizationJobDetailClient province={params.province} municipality={params.municipality} slug={params.organization} jobId={params.jobId} />
}
