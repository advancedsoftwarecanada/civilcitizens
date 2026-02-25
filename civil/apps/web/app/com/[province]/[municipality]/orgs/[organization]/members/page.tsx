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

export default function OrganizationMembersPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Members" description="People connected to this organization.">
      <OrganizationMembersClient province={params.province} municipality={params.municipality} slug={params.organization} />
    </OrganizationSection>
  )
}
