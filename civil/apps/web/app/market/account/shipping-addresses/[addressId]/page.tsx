import type { Metadata } from 'next'
import MarketShippingAddressEditorPageClient from '../../../_components/MarketShippingAddressEditorPageClient'

export const metadata: Metadata = {
  title: 'Edit Shipping Address',
}

export default async function MarketShippingAddressEditPage({ params }: { params: Promise<{ addressId: string }> }) {
  const resolved = await params
  return <MarketShippingAddressEditorPageClient addressId={resolved.addressId} />
}