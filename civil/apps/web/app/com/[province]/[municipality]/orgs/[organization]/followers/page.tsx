import OrganizationSection from '../../../../../_components/OrganizationSection'
import OrganizationMembersClient from '../../../../../_components/OrganizationMembersClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationFollowersPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Followers" description="People following or connected to this organization.">
      <OrganizationMembersClient province={params.province} municipality={params.municipality} organizationSlug={params.organization} />
    </OrganizationSection>
  )
}
