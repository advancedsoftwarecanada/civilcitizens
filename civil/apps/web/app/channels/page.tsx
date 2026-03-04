import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Messages',
}

export const dynamic = 'force-dynamic'

export default function ChannelsPage() {
  redirect('/messages')
}
