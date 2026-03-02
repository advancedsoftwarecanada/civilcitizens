import OrganizationSection from '../../../../../_components/OrganizationSection'
import OrganizationJobsPageClient from './OrganizationJobsPageClient'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationJobsPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Jobs" description="Open roles at this organization. Click a role to apply.">
      <OrganizationJobsPageClient province={params.province} municipality={params.municipality} slug={params.organization} />
    </OrganizationSection>
  )
}
