import type { Metadata } from 'next'
import Link from 'next/link'
import DashboardShell from '../../_components/DashboardShell'
import ShippingAddressesPanel from '../_components/ShippingAddressesPanel'
import YourOrdersPanel from '../_components/YourOrdersPanel'

export const metadata: Metadata = {
  title: 'Orders & Shipping',
}

export default function MarketAccountPage() {
  return (
    <DashboardShell className="bg-slate-50" mainClassName="space-y-6 pb-12">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Market · Buyer Account</p>
        <div className="mt-1 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Orders And Shipping</h1>
            <p className="mt-1 text-sm text-slate-500">Review your orders and manage the saved shipping addresses on your buyer account.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/market"
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
            >
              Back to Market
            </Link>
            <Link
              href="/market/cart"
              className="inline-flex items-center justify-center rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              View Cart
            </Link>
          </div>
        </div>
        <div className="mt-6">
          <section className="surface-card p-4 shadow-subtle">
            <div className="grid gap-4 lg:grid-cols-2">
              <YourOrdersPanel title="Your Orders" limit={10} />
              <ShippingAddressesPanel title="Addresses" basePath="/settings/addresses" />
            </div>
          </section>
        </div>
      </section>
    </DashboardShell>
  )
}
