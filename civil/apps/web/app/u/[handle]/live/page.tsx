import UserLiveRoomDirectoryPage from './roomDirectoryPage'
import DashboardShell from '../../../_components/DashboardShell'
import { RightRail } from '../../../_components/RightRail'

export default async function UserLiveDirectory({ params }: { params: Promise<{ handle: string }> }) {
  const resolved = await params
  return (
    <DashboardShell rightRail={<RightRail />} showMobileRightRail mainClassName="min-w-0 space-y-6" mainTopClassName="pt-4 md:pt-6">
      <UserLiveRoomDirectoryPage handle={resolved.handle} />
    </DashboardShell>
  )
}