import OrganizationSection from '../../../../../../../_components/OrganizationSection'
import OrganizationEventCreateClient from '../../../../../../../_components/OrganizationEventCreateClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationEventsCreatePage({ params }: PageProps) {
  return (
    <OrganizationSection title="Create Event" description="Create a draft event, upload photos, then publish when ready.">
      <OrganizationEventCreateClient province={params.province} municipality={params.municipality} slug={params.organization} />
    </OrganizationSection>
  )
}
