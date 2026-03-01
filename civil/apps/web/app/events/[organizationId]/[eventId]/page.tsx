import type { Metadata } from 'next'
import EventDetailPageClient from './EventDetailPageClient'

export const metadata: Metadata = {
  title: 'Event',
}

type PageProps = {
  params: {
    organizationId: string
    eventId: string
  }
}

export default function EventDetailPage({ params }: PageProps) {
  return <EventDetailPageClient organizationId={params.organizationId} eventId={params.eventId} />
}
