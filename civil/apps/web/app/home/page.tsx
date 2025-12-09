import FeedPageClient from '../_components/FeedPageClient'

export default function HomePage() {
  return (
    <FeedPageClient
      scope="all"
      sidebarActive="home"
      title="Civic Pulse"
      description="Everything happening across your friends, follows, and the communities you track."
    />
  )
}
