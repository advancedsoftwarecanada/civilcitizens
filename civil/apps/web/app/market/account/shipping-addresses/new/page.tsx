import type { Metadata } from 'next'
import MarketShippingAddressEditorPageClient from '../../../_components/MarketShippingAddressEditorPageClient'

export const metadata: Metadata = {
  title: 'Add Shipping Address',
}

export default function MarketShippingAddressNewPage() {
  return <MarketShippingAddressEditorPageClient />
}