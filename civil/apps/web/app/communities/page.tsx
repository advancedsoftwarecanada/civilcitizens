import FeedPageClient from '../_components/FeedPageClient'
import { RightRail } from '../_components/RightRail'

export default function CommunitiesFeedPage() {
  return (
    <FeedPageClient
      scope="communities"
      sidebarActive="communities"
      title="Community Feed"
      description="Only posts from the ridings, chambers, and local groups you follow."
      defaultSort="hot"
      showFeedSummary={false}
      sortOptions={[
        { value: 'hot', label: 'Smart' },
        { value: 'new', label: 'Newest' },
      ]}
      emptyState="No community updates yet. Follow a few more ridings or chambers to start building this feed."
      emptyStateCta={{ label: 'Open Community Settings', href: '/communities/settings' }}
      rightRail={<RightRail mode="communitiesFeed" />}
    />
  )
}
