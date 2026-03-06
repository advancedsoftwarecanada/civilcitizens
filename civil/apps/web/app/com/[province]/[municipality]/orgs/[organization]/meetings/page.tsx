import OrganizationSection from '../../../../../_components/OrganizationSection'
import OrganizationMeetingsClient from '../../../../../_components/OrganizationMeetingsClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationMeetingsPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Meetings">
      <OrganizationMeetingsClient mode="view" province={params.province} municipality={params.municipality} slug={params.organization} />
    </OrganizationSection>
  )
}
