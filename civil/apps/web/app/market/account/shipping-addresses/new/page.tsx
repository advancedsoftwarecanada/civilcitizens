import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Add Address',
}

export default function MarketShippingAddressNewPage() {
  redirect('/settings/addresses/new')
}
