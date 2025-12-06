import CommunitySection from '../../../_components/CommunitySection'
import CommunityPostsFeed from '../../../_components/CommunityPostsFeed'

export default function CommunityPostsPage() {
  return (
    <div className="space-y-6 py-8">
      <CommunitySection
        title="Posts"
        description="Local discussions, alerts, and civic updates from neighbours, MPs, and verified organizations."
      >
        <p>
          Posts automatically scope to the selected municipality, respecting its default community feed while still
          supporting Canada-wide civic broadcasts. Use the filters below to switch between citizen, municipal,
          provincial, and federal dispatches.
        </p>
      </CommunitySection>

      <CommunityPostsFeed />
    </div>
  )
}
