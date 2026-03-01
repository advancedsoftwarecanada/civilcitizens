import OrganizationSection from '../../../../../../../_components/OrganizationSection'
import OrganizationEventCreateClient from '../../../../../../../_components/OrganizationEventCreateClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
    eventId: string
  }
}

export default function OrganizationEventsManageEventPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Edit Event Draft" description="Update your draft, upload photos, then publish when ready.">
      <OrganizationEventCreateClient province={params.province} municipality={params.municipality} slug={params.organization} eventId={params.eventId} />
    </OrganizationSection>
  )
}
