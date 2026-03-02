import CommunitySection from '../../../_components/CommunitySection'
import OrganizationCreateButton from '../../../_components/OrganizationCreateButton'
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
      <div className="flex justify-end">
        <OrganizationCreateButton province={params.province} municipality={params.municipality} />
      </div>

      <p className="text-sm text-slate-600">Browse organizations in this community.</p>

      <CommunityOrganizationsList province={params.province} municipality={params.municipality} />
    </CommunitySection>
  )
}
