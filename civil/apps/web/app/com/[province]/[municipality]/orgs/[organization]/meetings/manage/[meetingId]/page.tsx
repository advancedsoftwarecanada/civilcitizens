import OrganizationSection from '../../../../../../../_components/OrganizationSection'
import OrganizationMeetingDraftEditorClient from '../../../../../../../_components/OrganizationMeetingDraftEditorClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
    meetingId: string
  }
}

export default function OrganizationMeetingsManageMeetingPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Edit Meeting Draft" description="Update draft settings, then publish when ready.">
      <OrganizationMeetingDraftEditorClient
        province={params.province}
        municipality={params.municipality}
        slug={params.organization}
        meetingId={params.meetingId}
      />
    </OrganizationSection>
  )
}
