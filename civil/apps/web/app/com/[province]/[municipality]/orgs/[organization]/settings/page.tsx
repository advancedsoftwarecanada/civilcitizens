import OrganizationSection from '../../../../../_components/OrganizationSection'
import OrganizationSettingsClient from '../../../../../_components/OrganizationSettingsClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationSettingsPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Organization settings" description="Update your organization profile photos.">
      <OrganizationSettingsClient province={params.province} municipality={params.municipality} slug={params.organization} />
    </OrganizationSection>
  )
}
