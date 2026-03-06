import FeedPageClient from '../_components/FeedPageClient'
import HomePushPromptGate from '../_components/HomePushPromptGate'
import { RightRail } from '../_components/RightRail'

export default function HomePage() {
  return (
    <>
      <HomePushPromptGate />
      <FeedPageClient
        scope="all"
        sidebarActive="home"
        title="Civic Pulse"
        description="Everything happening across your friends, follows, and the communities you track."
        defaultSort="hot"
        sortOptions={[
          {
            value: 'hot',
            label: 'Smart',
            description: 'Freshness, impressions, geography, and engagement keep the feed moving.',
          },
          {
            value: 'new',
            label: 'Latest',
            description: 'A straight chronological view of the newest posts in your network.',
          },
        ]}
        rightRail={<RightRail showOrganizations showRsvps />}
      />
    </>
  )
}
