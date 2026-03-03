import type { Metadata } from 'next'
import Link from 'next/link'
import DashboardShell from '../../_components/DashboardShell'

export const metadata: Metadata = {
  title: 'Marketplace Chats',
}

export default function MarketChatsPage() {
  return (
    <DashboardShell mainClassName="space-y-5 pb-12">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
        <h1 className="text-2xl font-semibold text-slate-900">Marketplace Chats</h1>
        <p className="mt-1 text-sm text-slate-600">Use chats to coordinate buyer-seller questions and sale agreements.</p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/messages"
            className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Open messages
          </Link>
          <Link
            href="/market"
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to market
          </Link>
        </div>
      </section>
    </DashboardShell>
  )
}
