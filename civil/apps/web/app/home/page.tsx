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
        title="Home Feed"
        description="Posts, events, and jobs from across your Civil network."
        emptyState="Your home feed is quiet right now. Follow more communities, people, and organizations to fill it out."
        emptyStateCta={{ label: 'Explore Communities', href: '/communities' }}
        defaultSort="hot"
        showFeedSummary={false}
        showSupplementalFeedItems={false}
        sortOptions={[
          {
            value: 'hot',
            label: 'Smart',
          },
          {
            value: 'new',
            label: 'Latest',
          },
        ]}
        rightRail={<RightRail showOrganizations showRsvps sticky={false} />}
      />
    </>
  )
}
