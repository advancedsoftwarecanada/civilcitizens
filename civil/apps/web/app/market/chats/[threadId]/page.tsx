import type { Metadata } from 'next'
import MarketChatThreadPageClient from './MarketChatThreadPageClient'

export const metadata: Metadata = {
  title: 'Marketplace Chat',
}

export default async function MarketChatThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const resolved = await params
  return <MarketChatThreadPageClient threadId={resolved.threadId} />
}
