import CommunitySection from '../../../_components/CommunitySection'
import CommunityJobsPageClient from './CommunityJobsPageClient'

type PageProps = {
  params: {
    province: string
    municipality: string
  }
}

export default function CommunityJobsPage({ params }: PageProps) {
  return (
    <CommunitySection title="Jobs" description="Permanent and contract roles from employers inside this municipality.">
      <CommunityJobsPageClient province={params.province} municipality={params.municipality} />
    </CommunitySection>
  )
}
