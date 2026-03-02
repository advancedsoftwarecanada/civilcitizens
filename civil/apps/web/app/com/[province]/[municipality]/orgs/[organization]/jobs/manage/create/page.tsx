import OrganizationSection from '../../../../../../../_components/OrganizationSection'
import OrganizationJobEditorClient from '../../OrganizationJobEditorClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationJobsManageCreatePage({ params }: PageProps) {
  return (
    <OrganizationSection title="Create Job" description="Create a draft job, then save and publish when ready.">
      <OrganizationJobEditorClient province={params.province} municipality={params.municipality} slug={params.organization} />
    </OrganizationSection>
  )
}
