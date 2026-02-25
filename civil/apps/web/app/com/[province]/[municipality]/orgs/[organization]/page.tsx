import OrganizationWallClient from '../../../../_components/OrganizationWallClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default async function OrganizationOverviewPage({ params }: PageProps) {
  const slug = params.organization.trim().toLowerCase()

  return <OrganizationWallClient province={params.province} municipality={params.municipality} slug={slug} initialOrg={null} />
}
