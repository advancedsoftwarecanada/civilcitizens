import MarketListingCivilPayPageClient from './MarketListingCivilPayPageClient'

export default function MarketListingCivilPayPage({ params }: { params: { listingId: string } }) {
  return <MarketListingCivilPayPageClient listingId={params.listingId} />
}