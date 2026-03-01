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

export default function OrganizationSettingsDetailsPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Details" description="Manage your organization profile, photos, and visibility.">
      <OrganizationSettingsClient province={params.province} municipality={params.municipality} slug={params.organization} section="details" />
    </OrganizationSection>
  )
}
