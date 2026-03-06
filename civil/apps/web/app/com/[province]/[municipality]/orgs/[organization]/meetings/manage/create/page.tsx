import OrganizationSection from '../../../../../../../_components/OrganizationSection'
import OrganizationMeetingDraftEditorClient from '../../../../../../../_components/OrganizationMeetingDraftEditorClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationMeetingsCreatePage({ params }: PageProps) {
  return (
    <OrganizationSection title="Create Meeting" description="Creating draft… you will be redirected to the meeting editor.">
      <OrganizationMeetingDraftEditorClient province={params.province} municipality={params.municipality} slug={params.organization} />
    </OrganizationSection>
  )
}
