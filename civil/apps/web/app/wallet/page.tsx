import ComingSoon from '../_components/ComingSoon'

export default function WalletPage() {
  return (
    <ComingSoon
      activeNavKey="wallet"
      title="Wallet is coming soon"
      message="Wallet, credits, and payouts are still being built. You can manage billing from your settings in the meantime."
      secondaryHref="/settings/billing"
      secondaryLabel="Open billing"
    />
  )
}
