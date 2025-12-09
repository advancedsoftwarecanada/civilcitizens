import type { Metadata } from 'next'
import MessagesPageClient from './MessagesPageClient'

export const metadata: Metadata = {
  title: 'Messages',
}

type MessagesPageProps = {
  searchParams?: {
    thread?: string | string[]
  }
}

export default function MessagesPage({ searchParams }: MessagesPageProps) {
  const threadParam = searchParams?.thread
  const initialThreadId = typeof threadParam === 'string' ? threadParam : undefined
  return <MessagesPageClient initialThreadId={initialThreadId} />
}
