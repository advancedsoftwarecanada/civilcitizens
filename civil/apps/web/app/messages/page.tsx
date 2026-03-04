import type { Metadata } from 'next'
import MessagesPageClient from './MessagesPageClient'
import { isMessagesNavSection } from '../_lib/messagesNav'

export const metadata: Metadata = {
  title: 'Messages',
}

type MessagesPageProps = {
  searchParams?: {
    thread?: string | string[]
    inbox?: string | string[]
  }
}

export default function MessagesPage({ searchParams }: MessagesPageProps) {
  const threadParam = searchParams?.thread
  const inboxParam = searchParams?.inbox
  const initialThreadId = typeof threadParam === 'string' ? threadParam : undefined
  const initialInboxSection = typeof inboxParam === 'string' && isMessagesNavSection(inboxParam) ? inboxParam : undefined
  return <MessagesPageClient initialThreadId={initialThreadId} initialInboxSection={initialInboxSection} />
}
