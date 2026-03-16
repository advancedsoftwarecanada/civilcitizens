import FeedPageClient from '../_components/FeedPageClient'
import { RightRail } from '../_components/RightRail'

export default function NetworkFeedPage() {
  return (
    <FeedPageClient
      scope="network"
      sidebarActive="network"
      title="Network Feed"
      description="Professional updates from your Civil network across Canada."
      defaultSort="hot"
      showFeedSummary={false}
      sortOptions={[
        { value: 'hot', label: 'Smart' },
        { value: 'new', label: 'Newest' },
      ]}
      emptyState="No network activity yet. Start connecting with professionals and their updates will show up here."
      emptyStateCta={{ label: 'Find People', href: '/search' }}
      rightRail={<RightRail mode="network" showRsvps />}
    />
  )
}
