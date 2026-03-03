import MarketListingDetailPageClient from './MarketListingDetailPageClient'

export default function MarketListingDetailPage({ params }: { params: { listingId: string } }) {
  return <MarketListingDetailPageClient listingId={params.listingId} />
}
