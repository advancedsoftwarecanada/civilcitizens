import UserLiveDraftEditorClient from '../../_components/UserLiveDraftEditorClient'
import DashboardShell from '../../../_components/DashboardShell'
import { RightRail } from '../../../_components/RightRail'

export default async function LiveManagePage({ params }: { params: Promise<{ spaceId: string }> }) {
  const resolved = await params
  return (
    <DashboardShell rightRail={<RightRail />} showMobileRightRail mainClassName="min-w-0 space-y-6" mainTopClassName="pt-4 md:pt-6">
      <UserLiveDraftEditorClient spaceId={resolved.spaceId} />
    </DashboardShell>
  )
}