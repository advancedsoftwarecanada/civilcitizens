import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Marketplace',
}

export default function MarketChatsPage() {
  redirect('/messages?inbox=market')
}
