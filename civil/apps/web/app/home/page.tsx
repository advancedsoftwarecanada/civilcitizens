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
        title="Civil Pulse"
        description="The broadest view of your civic world, balancing local posts, organizations, events, and opportunity across Civil."
        emptyState="Your Civil Pulse is quiet right now. Follow more communities, people, and organizations to build a sharper civic signal."
        emptyStateCta={{ label: 'Explore Communities', href: '/communities' }}
        defaultSort="hot"
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
