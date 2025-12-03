import FeatureScaffold from '../_components/FeatureScaffold'

const EVENT_HIGHLIGHTS = [
  {
    title: 'Civic calendar',
    description: 'Aggregate hearings, town halls, and grassroots meetups into one discoverable feed.',
    status: 'soon' as const,
  },
  {
    title: 'Ticketing + RSVPs',
    description: 'Stripe-powered ticketing connects to your wallet and organization roster.',
    status: 'soon' as const,
  },
]

const EVENT_ROADMAP = [
  { title: 'Volunteer matching', detail: 'Coordinate duties, shifts, and messaging for each event.' },
  { title: 'Livestream hub', detail: 'Embed streams with moderated chat and auto-archived notes.' },
]

export default function EventsPage() {
  return (
    <FeatureScaffold
      activeNavKey="events"
      title="Events"
      description="Plan civic gatherings, publish agendas, and sync logistics with your chamber."
      heroBadge="Early concept"
      highlights={EVENT_HIGHLIGHTS}
      roadmap={EVENT_ROADMAP}
    />
  )
}
