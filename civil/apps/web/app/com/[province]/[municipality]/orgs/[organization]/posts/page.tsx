import OrganizationSection from '../../../../../_components/OrganizationSection'

export default function OrganizationPostsPage() {
  return (
    <OrganizationSection title="Posts" description="Broadcasts and bulletins from this local team.">
      <p>
        Once the posting API lands, this surface will mirror the municipal feed but scoped to members and followers of
        the organization. It will support friends-only notices, public statements, and cross-posts into the
        municipality-wide feed.
      </p>
    </OrganizationSection>
  )
}
