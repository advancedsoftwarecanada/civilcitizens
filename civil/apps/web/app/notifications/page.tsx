import type { Metadata } from 'next'
import NotificationsClient from './NotificationsClient'

export const metadata: Metadata = {
  title: 'Notifications',
}

export default function NotificationsPage() {
  return <NotificationsClient />
}
