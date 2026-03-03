import type { Metadata } from 'next'
import MarketPageClient from './MarketPageClient'

export const metadata: Metadata = {
  title: 'Market',
}

export default function MarketPage() {
  return <MarketPageClient />
}
