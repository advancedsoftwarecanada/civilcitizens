import type { Metadata } from 'next'
import AddressSearchPageClient from './AddressSearchPageClient'

export const metadata: Metadata = {
  title: 'Addresses',
}

export default function AddressesPage() {
  return <AddressSearchPageClient />
}