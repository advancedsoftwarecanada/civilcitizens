import MarketOrderPageClient from './MarketOrderPageClient'

export const metadata = {
  title: 'Order • Civil Market',
}

export default async function MarketOrderPage({ params }: { params: { orderId: string } }) {
  return <MarketOrderPageClient orderId={params.orderId} />
}
