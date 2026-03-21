import type { Metadata } from 'next'
import Link from 'next/link'
import DashboardShell from '../../_components/DashboardShell'
import { RightRail } from '../../_components/RightRail'
import ShippingAddressesPanel from '../../market/_components/ShippingAddressesPanel'

export const metadata: Metadata = {
  title: 'Addresses',
}

export default function SettingsAddressesPage() {
  return (
    <DashboardShell
      className="bg-slate-50"
      mainClassName="space-y-6 pb-12"
      rightRail={<RightRail showOrganizations showRsvps />}
      showMobileRightRail
    >
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Settings</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">Addresses</h1>
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
          >
            Back to Settings
          </Link>
        </div>
      </section>

      <ShippingAddressesPanel title="Addresses" basePath="/settings/addresses" />
    </DashboardShell>
  )
}
