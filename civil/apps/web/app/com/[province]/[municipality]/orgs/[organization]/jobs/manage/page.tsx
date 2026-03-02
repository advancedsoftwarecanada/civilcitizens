import OrganizationSection from '../../../../../../_components/OrganizationSection'
import OrganizationJobsManageClient from '../OrganizationJobsManageClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationJobsManagePage({ params }: PageProps) {
  return (
    <OrganizationSection title="Manage Jobs" description="Create draft jobs, save, publish, and manage applications.">
      <OrganizationJobsManageClient province={params.province} municipality={params.municipality} slug={params.organization} />
    </OrganizationSection>
  )
}
