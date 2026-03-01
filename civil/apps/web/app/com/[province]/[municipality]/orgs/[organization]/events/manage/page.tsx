import OrganizationSection from '../../../../../../_components/OrganizationSection'
import OrganizationEventsClient from '../../../../../../_components/OrganizationEventsClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationEventsManagePage({ params }: PageProps) {
  return (
    <OrganizationSection title="Manage Events" description="Publish and manage events for this organization.">
      <OrganizationEventsClient mode="manage" province={params.province} municipality={params.municipality} slug={params.organization} />
    </OrganizationSection>
  )
}
