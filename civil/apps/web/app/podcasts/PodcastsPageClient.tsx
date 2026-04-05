'use client'

import FeedPageClient from '../_components/FeedPageClient'
import PodcastsRightRail from './PodcastsRightRail'

export default function PodcastsPageClient() {
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
      hideComposerLauncher
      emptyState="No podcast episodes yet. Publish the first one to start your network's listening queue."
      rightRail={({ openComposer }) => <PodcastsRightRail onUploadPodcast={() => openComposer('post')} />}
      videoKindFilter="podcast"
      composerVideoKind="podcast"
    />
  )
}