import type { Metadata } from 'next'
import MarketNewListingPageClient from './MarketNewListingPageClient'

export const metadata: Metadata = {
  title: 'Create Listing',
}

export default function MarketNewListingPage() {
  return <MarketNewListingPageClient />
}
