import FeedPageClient from '../_components/FeedPageClient'
import { RightRail } from '../_components/RightRail'

export default function OrganizationsPage() {
  return (
    <FeedPageClient
      scope="organizations"
      sidebarActive="organizations"
      title="Organizations"
      description="Updates from organizations you follow."
      emptyState="No organization updates yet. Follow organizations in your community to see their posts here."
      emptyStateCta={{ label: 'Browse Communities', href: '/communities' }}
      rightRail={<RightRail mode="organizations" />}
    />
  )
}
