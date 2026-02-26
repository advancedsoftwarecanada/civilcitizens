import OrganizationHeader from '../../../../_components/OrganizationHeader'
import OrganizationWallClient from '../../../../_components/OrganizationWallClient'

export const dynamic = 'force-dynamic'

const titleCase = (value: string) =>
  value
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default async function OrganizationOverviewPage({ params }: PageProps) {
  const slug = params.organization.trim().toLowerCase()
  const name = titleCase(slug)

  return (
    <div className="space-y-6">
      <OrganizationHeader org={null} fallbackName={name} province={params.province} municipality={params.municipality} slug={slug} />
      <OrganizationWallClient province={params.province} municipality={params.municipality} slug={slug} initialOrg={null} />
    </div>
  )
}
