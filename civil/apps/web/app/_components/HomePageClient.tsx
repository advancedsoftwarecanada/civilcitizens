'use client'

import FamilyFeedClient from './FamilyFeedClient'
import HomeTripsDashboard from './HomeTripsDashboard'
import HomePushPromptGate from './HomePushPromptGate'
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
      <HomeTripsDashboard />
    </>
  )
}
