import FeedPageClient from '../_components/FeedPageClient'
import FriendsRightRail from '../_components/FriendsRightRail'

export default function FriendsFeedPage() {
  return (
    <FeedPageClient
      scope="friends"
      sidebarActive="friends"
      title="Friends Feed"
      description="Updates from the people you follow and trust on Civil."
      emptyState="No friend activity yet. Once your friends start posting, their updates will land here."
      emptyStateCta={{ label: 'Find Friends', href: '/search' }}
      rightRail={<FriendsRightRail />}
    />
  )
}
