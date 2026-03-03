import type { Metadata } from 'next'
import MarketListingsPageClient from './MarketListingsPageClient'

export const metadata: Metadata = {
  title: 'Your Listings',
}

export default function MarketListingsPage() {
  return <MarketListingsPageClient />
}
