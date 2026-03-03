import type { Metadata } from 'next'
import MarketChatItemPageClient from './MarketChatItemPageClient'

export const metadata: Metadata = {
  title: 'Marketplace',
}

export default async function MarketChatItemPage({ params }: { params: Promise<{ listingId: string }> }) {
  const resolved = await params
  return <MarketChatItemPageClient listingId={resolved.listingId} />
}
