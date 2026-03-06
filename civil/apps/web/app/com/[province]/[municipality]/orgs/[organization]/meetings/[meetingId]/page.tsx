import type { Metadata } from 'next'
import OrganizationMeetingRoomClient from '../../../../../../_components/OrganizationMeetingRoomClient'

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
    <OrganizationMeetingRoomClient
      province={params.province}
      municipality={params.municipality}
      organization={params.organization}
      meetingId={params.meetingId}
    />
  )
}
