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

export default function OrganizationJoinsPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Joins" description="People who joined or connected with this organization. Management tools are in Settings → Members.">
      <OrganizationMembersClient province={params.province} municipality={params.municipality} organizationSlug={params.organization} />
    </OrganizationSection>
  )
}
