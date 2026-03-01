import OrganizationSection from '../../../../../_components/OrganizationSection'
import OrganizationEventsClient from '../../../../../_components/OrganizationEventsClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationEventsPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Events">
      <OrganizationEventsClient mode="view" province={params.province} municipality={params.municipality} slug={params.organization} />
    </OrganizationSection>
  )
}
