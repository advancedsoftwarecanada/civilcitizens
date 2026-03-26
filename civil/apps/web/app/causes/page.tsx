import FeedPageClient from '../_components/FeedPageClient'
import { RightRail } from '../_components/RightRail'

export default function CausesFeedPage() {
  return (
    <FeedPageClient
      scope="causes"
      sidebarActive="causes"
      title="Causes"
      description="Funding campaigns created in the communities you follow."
      defaultSort="new"
      sortOptions={[
        { value: 'new', label: 'Newest' },
        { value: 'hot', label: 'Trending' },
      ]}
      emptyState="No causes are active in the communities you follow yet."
      rightRail={<RightRail mode="causesFeed" />}
      showFeedSummary={false}
      showSupplementalFeedItems={false}
      hideComposerLauncher
    />
  )
}