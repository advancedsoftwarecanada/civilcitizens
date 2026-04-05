import type { Metadata } from 'next'
import OrganizationMeetingRoomClient from '../../../../../../_components/OrganizationMeetingRoomClient'
import DashboardShell from '../../../../../../../_components/DashboardShell'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Meeting Room',
}

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
    meetingId: string
  }
}

export default function OrganizationMeetingRoomPage({ params }: PageProps) {
  return (
    <DashboardShell mainClassName="min-w-0" mainTopClassName="pt-4 md:pt-6">
      <OrganizationMeetingRoomClient
        province={params.province}
        municipality={params.municipality}
        organization={params.organization}
        meetingId={params.meetingId}
      />
    </DashboardShell>
  )
}
