import FeatureScaffold from '../_components/FeatureScaffold'

const MARKET_HIGHLIGHTS = [
  {
    title: 'Civic marketplace',
    description: 'Discover trusted vendors for campaigns, community events, and civic technology.',
    status: 'soon' as const,
  },
  {
    title: 'Maple bids',
    description: 'Premium members will be able to post RFPs and hire directly through escrow.',
    status: 'soon' as const,
  },
]

const MARKET_ROADMAP = [
  { title: 'Merch fulfilment', detail: 'Bundle verified merchandise with wallet-powered loyalty.' },
  { title: 'Service bundles', detail: 'Pair policy research, creative, and outreach services in curated packs.' },
]

export default function MarketPage() {
  return (
    <FeatureScaffold
      activeNavKey="market"
      title="Market"
      description="A curated marketplace for civic goods, services, and sponsorship opportunities."
      heroBadge="Marketplace"
      highlights={MARKET_HIGHLIGHTS}
      roadmap={MARKET_ROADMAP}
    />
  )
}
