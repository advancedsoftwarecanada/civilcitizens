import type { Metadata } from 'next'
import MessagesPageClient from './MessagesPageClient'

export const metadata: Metadata = {
  title: 'Messages',
}

export default function MessagesPage() {
  return <MessagesPageClient />
}
