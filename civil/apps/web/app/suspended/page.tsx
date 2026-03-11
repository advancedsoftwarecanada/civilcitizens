import type { Metadata } from 'next'
import SuspendedPageClient from './SuspendedPageClient'

export const metadata: Metadata = {
  title: 'Suspended',
}

export default function SuspendedPage() {
  return <SuspendedPageClient />
}