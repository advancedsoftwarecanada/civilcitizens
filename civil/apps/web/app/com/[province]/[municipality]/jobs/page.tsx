import CommunitySection from '../../../_components/CommunitySection'

export default function CommunityJobsPage() {
  return (
    <CommunitySection title="Jobs" description="Permanent and contract roles from employers inside this municipality.">
      <p>
        Job posts will require a verified organization and a Canada-only address. The routing scaffold is ready so we can
        plug in the Prisma models and fetcher hooks once the hiring API is finalized.
      </p>
    </CommunitySection>
  )
}
