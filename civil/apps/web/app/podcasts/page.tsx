import FeedPageClient from '../_components/FeedPageClient'
import { RightRail } from '../_components/RightRail'

export default function PodcastsPage() {
  return (
    <FeedPageClient
      scope="network"
      sidebarActive="podcasts"
      title="Podcasts"
      description="Long-form Canadian conversations from your professional network, with audio-only and video episodes."
      defaultSort="hot"
      sortOptions={[
        { value: 'hot', label: 'Smart' },
        { value: 'new', label: 'Newest' },
      ]}
      showFeedSummary={false}
      emptyState="No podcast episodes yet. Publish the first one to start your network's listening queue."
      emptyStateCta={{ label: 'Find People', href: '/search' }}
      rightRail={<RightRail mode="network" showRsvps />}
      videoKindFilter="podcast"
      composerVideoKind="podcast"
    />
  )
}
