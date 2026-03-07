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
