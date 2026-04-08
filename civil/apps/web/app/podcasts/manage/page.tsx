import DashboardShell from '../../_components/DashboardShell'
import PodcastsManagePageClient, { PodcastsManagePageRail } from './PodcastsManagePageClient'

export default function PodcastsManagePage() {
  return (
    <DashboardShell rightRail={<PodcastsManagePageRail />} mainClassName="min-w-0 space-y-6" mainTopClassName="pt-4 md:pt-6">
      <PodcastsManagePageClient />
    </DashboardShell>
  )
}