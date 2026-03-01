import OrganizationSection from '../../../../../../_components/OrganizationSection'
import OrganizationMembersAdminClient from '../../../../../../_components/OrganizationMembersAdminClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationSettingsMembersPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Members" description="Kick, ban, and assign roles.">
      <OrganizationMembersAdminClient province={params.province} municipality={params.municipality} slug={params.organization} />
    </OrganizationSection>
  )
}