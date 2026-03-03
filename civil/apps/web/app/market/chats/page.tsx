import type { Metadata } from 'next'
import MarketChatsPageClient from './MarketChatsPageClient'

export const metadata: Metadata = {
  title: 'Marketplace',
}

export default function MarketChatsPage() {
  return <MarketChatsPageClient />
}
