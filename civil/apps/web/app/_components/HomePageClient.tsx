'use client'

import FeedPageClient from './FeedPageClient'
import FamilyFeedClient from './FamilyFeedClient'
import HomePushPromptGate from './HomePushPromptGate'
import { RightRail } from './RightRail'
import { useViewerStore } from '../_lib/viewerStore'

export default function HomePageClient() {
  const viewer = useViewerStore((state) => state.me)
  const hydrated = useViewerStore((state) => state.hydrated)
  const familyViewHydrated = useViewerStore((state) => state.familyViewHydrated)
  const familyView = useViewerStore((state) => state.familyView)
  const isFamilyLockedSession = Boolean(familyView) || viewer?.accountType === 'family_member'

  if (!hydrated || !familyViewHydrated) {
    return null
  }

  if (isFamilyLockedSession) {
    return <FamilyFeedClient />
  }

  return (
    <>
      <HomePushPromptGate />
      <FeedPageClient
        scope="all"
        sidebarActive="home"
        title=""
        emptyState="Your home feed is quiet right now. Follow more chambers of citizens, people, and organizations to fill it out."
        emptyStateCta={{ label: 'Explore Chambers of Citizens', href: '/chambers' }}
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
        rightRail={<RightRail mode="home" showOrganizations showRsvps />}
      />
    </>
  )
}
