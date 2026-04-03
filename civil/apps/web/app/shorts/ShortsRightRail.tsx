'use client'

import type { ApiPost } from '../_components/PostComposer'
import TopicsRightRail, { type TopicListItem } from '../topics/TopicsRightRail'
import ShortsUploadRailCard from './ShortsUploadRailCard'

type ShortsRightRailProps = {
  onPostCreated?: (post: ApiPost) => void
  onFollowedTopicsChange?: (items: TopicListItem[], authenticated: boolean) => void
}

export default function ShortsRightRail({ onPostCreated, onFollowedTopicsChange }: ShortsRightRailProps) {
  return (
    <div className="sticky top-6 space-y-6 pb-6">
      <ShortsUploadRailCard onPostCreated={onPostCreated} />
      <TopicsRightRail onFollowedTopicsChange={onFollowedTopicsChange} />
    </div>
  )
}