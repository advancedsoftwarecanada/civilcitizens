import OrganizationSection from '../../../../../_components/OrganizationSection'
import OrganizationControlPanelClient from '../../../../../_components/OrganizationControlPanelClient'

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
    <OrganizationSection title="Control Panel" description="Manage every part of your organization from one place.">
      <OrganizationControlPanelClient province={params.province} municipality={params.municipality} organization={params.organization} />
    </OrganizationSection>
  )
}
