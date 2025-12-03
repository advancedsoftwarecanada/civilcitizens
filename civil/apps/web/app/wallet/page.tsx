import FeatureScaffold from '../_components/FeatureScaffold'

const WALLET_HIGHLIGHTS = [
  {
    title: 'Civic wallet',
    description: 'Track premium billing, organization seats, and event payouts in one ledger.',
    status: 'ready' as const,
    actions: [{ label: 'Open billing', href: '/settings/billing' }],
  },
  {
    title: 'Maple credits',
    description: 'Earn loyalty for civic actions, then redeem inside Market or future events.',
    status: 'soon' as const,
  },
]

const WALLET_ROADMAP = [
  { title: 'Multi-currency', detail: 'Support CAD + USD with instant tax summaries.' },
  { title: 'Custody + payouts', detail: 'Route stipends and sponsorship payouts directly to your wallet.' },
]

export default function WalletPage() {
  return (
    <FeatureScaffold
      activeNavKey="wallet"
      title="Wallet"
      description="Billing, credits, and payouts unified for every civic action."
      heroBadge="Financial ops"
      highlights={WALLET_HIGHLIGHTS}
      roadmap={WALLET_ROADMAP}
    />
  )
}
