import type { Metadata } from 'next'
import WorkApplicationsPageClient from './WorkApplicationsPageClient'

export const metadata: Metadata = {
  title: 'Your Applications',
}

export default function WorkApplicationsPage() {
  return <WorkApplicationsPageClient />
}
