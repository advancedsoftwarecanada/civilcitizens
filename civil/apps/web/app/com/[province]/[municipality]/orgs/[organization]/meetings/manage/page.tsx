import OrganizationSection from '../../../../../../_components/OrganizationSection'
import OrganizationMeetingsClient from '../../../../../../_components/OrganizationMeetingsClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationMeetingsManagePage({ params }: PageProps) {
  return (
    <OrganizationSection title="Manage Meetings">
      <OrganizationMeetingsClient mode="manage" province={params.province} municipality={params.municipality} slug={params.organization} />
    </OrganizationSection>
  )
}
