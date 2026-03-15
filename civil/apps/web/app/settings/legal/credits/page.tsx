import Link from 'next/link'
import DashboardShell from '../../../_components/DashboardShell'

export default function SettingsLegalCreditsPage() {
  return (
    <DashboardShell className="bg-slate-50" mainClassName="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Settings</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">Legal Credits</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Civil Citizens uses third-party mapping and geographic data tools that require attribution. This page centralizes those notices.
            </p>
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to Settings
          </Link>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Maps</p>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">Mapping Credits</h2>
        <div className="mt-4 space-y-4 text-sm leading-6 text-slate-700">
          <div>
            <p className="font-semibold text-slate-900">MapLibre</p>
            <p>Civil Citizens uses MapLibre GL JS to render interactive maps in onboarding and district previews.</p>
            <Link href="https://maplibre.org/" className="font-semibold text-[var(--cc-primary)] hover:underline">
              https://maplibre.org/
            </Link>
          </div>

          <div>
            <p className="font-semibold text-slate-900">MapTiler</p>
            <p>Base map styles and tile presentation are powered through MapTiler-compatible map assets.</p>
            <Link href="https://www.maptiler.com/copyright/" className="font-semibold text-[var(--cc-primary)] hover:underline">
              https://www.maptiler.com/copyright/
            </Link>
          </div>

          <div>
            <p className="font-semibold text-slate-900">OpenStreetMap Contributors</p>
            <p>Underlying map data includes OpenStreetMap content made available by the OpenStreetMap contributors.</p>
            <Link href="https://www.openstreetmap.org/copyright" className="font-semibold text-[var(--cc-primary)] hover:underline">
              https://www.openstreetmap.org/copyright
            </Link>
          </div>
        </div>
      </section>
    </DashboardShell>
  )
}
