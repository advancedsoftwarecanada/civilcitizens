import OrganizationSection from '../../../../../../../_components/OrganizationSection'
import OrganizationJobEditorClient from '../../OrganizationJobEditorClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
    jobId: string
  }
}

export default function OrganizationJobsManageDraftPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Edit Job Draft">
      <OrganizationJobEditorClient
        province={params.province}
        municipality={params.municipality}
        slug={params.organization}
        jobId={params.jobId}
      />
    </OrganizationSection>
  )
}
