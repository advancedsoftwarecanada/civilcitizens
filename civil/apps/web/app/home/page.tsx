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
        rightRail={<RightRail showOrganizations showRsvps />}
      />
    </>
  )
}
