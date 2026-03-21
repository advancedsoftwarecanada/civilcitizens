import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Edit Address',
}

export default async function MarketShippingAddressEditPage({ params }: { params: Promise<{ addressId: string }> }) {
  const resolved = await params
  redirect(`/settings/addresses/${encodeURIComponent(resolved.addressId)}`)
}
