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

export default function OrganizationSettingsGovernancePage({ params }: PageProps) {
  return (
    <OrganizationSection title="Governance" description="Plans, join mode, sponsorships, achievements, and governance controls.">
      <OrganizationSettingsClient province={params.province} municipality={params.municipality} slug={params.organization} section="governance" />
    </OrganizationSection>
  )
}
