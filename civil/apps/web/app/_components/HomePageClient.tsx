'use client'

import FeedPageClient from './FeedPageClient'
import FamilyFeedClient from './FamilyFeedClient'
import HomePushPromptGate from './HomePushPromptGate'
import { RightRail } from './RightRail'
import { useViewerStore } from '../_lib/viewerStore'

export default function HomePageClient() {
  const viewer = useViewerStore((state) => state.me)
  const familyView = useViewerStore((state) => state.familyView)
  const isFamilyLockedSession = Boolean(familyView) || viewer?.accountType === 'family_member'

  if (isFamilyLockedSession) {
    return <FamilyFeedClient />
  }

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