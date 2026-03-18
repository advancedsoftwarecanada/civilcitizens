import OrganizationSection from '../../../../../../_components/OrganizationSection'
import OrganizationSettingsClient from '../../../../../../_components/OrganizationSettingsClient'
import { fetchCommunityOrganization } from '../../../../../../../_lib/organizations'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default async function OrganizationSettingsDetailsPage({ params }: PageProps) {
  const org = await fetchCommunityOrganization({
    province: params.province,
    municipality: params.municipality,
    slug: params.organization,
  })

  return (
    <OrganizationSection variant="plain">
      <OrganizationSettingsClient
        province={params.province}
        municipality={params.municipality}
        slug={params.organization}
        initialOrg={org}
        section="details"
      />
    </OrganizationSection>
  )
}
