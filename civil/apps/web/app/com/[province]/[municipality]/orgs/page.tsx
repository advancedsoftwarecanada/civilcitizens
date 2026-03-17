import CommunitySection from '../../../_components/CommunitySection'
import CommunityOrganizationsList from '../../../_components/CommunityOrganizationsList'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
  }
}

export default async function CommunityOrganizationsPage({ params }: PageProps) {
  return (
    <CommunitySection title="Organizations" description="Local clubs, unions, associations, and boards rooted in this city.">
      <CommunityOrganizationsList province={params.province} municipality={params.municipality} />
    </CommunitySection>
  )
}
