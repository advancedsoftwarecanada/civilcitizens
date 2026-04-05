import UserLivesDashboardClient from './_components/UserLivesDashboardClient'
import DashboardShell from '../_components/DashboardShell'
import LiveLandingRail from './_components/LiveLandingRail'

export default function LivePage() {
  return (
    <DashboardShell rightRail={<LiveLandingRail />} showMobileRightRail mainClassName="min-w-0 space-y-6" mainTopClassName="pt-4 md:pt-6">
      <UserLivesDashboardClient />
    </DashboardShell>
  )
}