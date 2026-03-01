import OrganizationSection from '../../../../../../_components/OrganizationSection'
import OrganizationSettingsClient from '../../../../../../_components/OrganizationSettingsClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationSettingsRolesPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Roles" description="Create and manage organization ranks and permissions.">
      <OrganizationSettingsClient province={params.province} municipality={params.municipality} slug={params.organization} section="roles" />
    </OrganizationSection>
  )
}
