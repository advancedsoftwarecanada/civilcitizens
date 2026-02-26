import type { Metadata } from 'next'
import ChannelsPageClient from './ChannelsPageClient'

export const metadata: Metadata = {
  title: 'Channels',
}

export const dynamic = 'force-dynamic'

export default function ChannelsPage() {
  return <ChannelsPageClient />
}
