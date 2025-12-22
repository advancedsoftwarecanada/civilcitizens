import OrganizationWallClient from '../../../../_components/OrganizationWallClient'
import { fetchCommunityOrganization } from '../../../../../_lib/organizations'

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
  const org = await fetchCommunityOrganization({ province: params.province, municipality: params.municipality, slug })

  if (!org) {
    return (
      <div className="surface-card px-6 py-5 shadow-subtle">
        <p className="text-sm text-slate-600">Organization not found.</p>
      </div>
    )
  }

  return (
    <OrganizationWallClient province={params.province} municipality={params.municipality} slug={slug} initialOrg={org} />
  )
}
