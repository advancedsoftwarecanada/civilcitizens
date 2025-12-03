import FeatureScaffold from '../_components/FeatureScaffold'

const ORG_HIGHLIGHTS = [
  {
    title: 'Organization HQ',
    description: 'Manage members, publish updates, and run civic programs from a single dashboard.',
    status: 'ready' as const,
    actions: [{ label: 'Create organization', href: '/settings/billing#business-create' }],
  },
  {
    title: 'Seat management',
    description: 'Assign billing seats, roles, and verification badges to your team.',
    status: 'soon' as const,
  },
]

const ORG_ROADMAP = [
  { title: 'Sponsorship tools', detail: 'Sell placements and manage applications with Stripe-native payouts.' },
  { title: 'Civic workflows', detail: 'Templates for petitions, volunteer drives, and policy submissions.' },
]

export default function OrganizationsPage() {
  return (
    <FeatureScaffold
      activeNavKey="organizations"
      title="Organizations"
      description="Civic teams, non-profits, and businesses can operate directly inside Civil Citizens."
      heroBadge="Studio"
      highlights={ORG_HIGHLIGHTS}
      roadmap={ORG_ROADMAP}
    />
  )
}
