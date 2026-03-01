import type { Metadata } from 'next'
import OrganizationEventDetailClient from '../../../../../../_components/OrganizationEventDetailClient'

export const metadata: Metadata = {
  title: 'Event',
}

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
    eventId: string
  }
}

export default function OrganizationEventDetailPage({ params }: PageProps) {
  return (
    <OrganizationEventDetailClient
      province={params.province}
      municipality={params.municipality}
      organization={params.organization}
      eventId={params.eventId}
    />
  )
}
