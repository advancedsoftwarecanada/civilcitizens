'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import DashboardShell from '../../../_components/DashboardShell'
import { buildApiUrl } from '../../../_lib/api'

type PageProps = {
  params: {
    partySlug: string
  }
}

type FederalPartyDetailResponse = {
  party?: {
    id: string
    slug: string
    name: string
    shortName: string | null
    updatedAt: string
  }
  politicians?: Array<{
    id: string
    slug: string
    displayName: string
    officeType: string | null
    provinceCode: string | null
    communitySlug: string | null
    lastScrapeAt: string | null
    profileUrl: string | null
    xmlUrl: string | null
    photoUrl: string | null
    lastXmlSyncAt: string | null
    lastHtmlSyncAt: string | null
    contact: {
      email: string | null
      website: string | null
    }
    district: {
      name: string
      slug: string
      provinceCode: string
    } | null
  }>
  associations?: Array<{
    id: string
    associationName: string
    registrationStatus: string | null
    provinceCode: string
    communitySlug: string
    registeredAt: string | null
    deregisteredAt: string | null
  }>
}

export default function FederalPartyPage({ params }: PageProps) {
  const [payload, setPayload] = useState<FederalPartyDetailResponse | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setStatus('loading')
      try {
        const res = await fetch(buildApiUrl(`/politicians/federal/${encodeURIComponent(params.partySlug)}`), { cache: 'no-store' })
        if (!res.ok) throw new Error('request_failed')
        const data = (await res.json().catch(() => null)) as FederalPartyDetailResponse | null
        if (!cancelled) {
          setPayload(data)
          setStatus('ready')
        }
      } catch {
        if (!cancelled) {
          setPayload(null)
          setStatus('error')
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [params.partySlug])

  return (
    <DashboardShell mainClassName="space-y-6">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Federal Party</p>
        <h1 className="text-2xl font-semibold text-slate-900">{payload?.party?.shortName ?? payload?.party?.name ?? params.partySlug}</h1>
        <p className="text-sm text-slate-600">Federal party directory and imported riding associations.</p>
      </section>

      <section className="surface-card space-y-4 px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Politicians</h2>
          <p className="mt-1 text-sm text-slate-600">Scraped member cards with direct links back to Commons and public contact details.</p>
        </div>

        {status === 'loading' ? <p className="text-sm text-slate-500">Loading party data…</p> : null}
        {status === 'error' ? <p className="text-sm text-rose-600">Unable to load this party.</p> : null}
        {status === 'ready' && !payload?.politicians?.length ? <p className="text-sm text-slate-500">No politician profiles have been scraped for this party yet.</p> : null}

        {payload?.politicians?.length ? (
          <ul className="space-y-3">
            {payload.politicians.map((politician) => (
              <li key={politician.id} className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-subtle">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="relative h-20 w-20 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                    {politician.photoUrl ? (
                      <img src={politician.photoUrl} alt={politician.displayName} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-slate-500">
                        {politician.displayName
                          .split(/\s+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((part) => part.charAt(0).toUpperCase())
                          .join('') || 'MP'}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Link href={`/politicians/federal/${encodeURIComponent(params.partySlug)}/${encodeURIComponent(politician.slug)}`} className="text-base font-semibold text-slate-900 hover:text-[var(--cc-primary)] hover:underline">
                          {politician.displayName}
                        </Link>
                        <p className="mt-1 text-sm text-slate-600">
                          {politician.officeType ?? 'Profile'}
                          {politician.district?.name ? ` · ${politician.district.name}` : politician.provinceCode && politician.communitySlug ? ` · ${politician.provinceCode.toUpperCase()} · ${politician.communitySlug}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {politician.lastHtmlSyncAt ? <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">Details ready</span> : null}
                        {politician.lastScrapeAt ? <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">Scraped</span> : null}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-sm">
                      <Link
                        href={`/politicians/federal/${encodeURIComponent(params.partySlug)}/${encodeURIComponent(politician.slug)}`}
                        className="inline-flex items-center rounded-full border border-[var(--cc-primary)]/20 bg-[var(--cc-primary)]/5 px-3 py-1.5 font-semibold text-[var(--cc-primary)] hover:border-[var(--cc-primary)]/35"
                      >
                        Open profile
                      </Link>
                      {politician.profileUrl ? (
                        <a
                          href={politician.profileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:border-slate-300"
                        >
                          Commons
                        </a>
                      ) : null}
                      {politician.contact.website ? (
                        <a
                          href={politician.contact.website}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:border-slate-300"
                        >
                          Website
                        </a>
                      ) : null}
                      {politician.contact.email ? (
                        <a href={`mailto:${politician.contact.email}`} className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:border-slate-300">
                          Email
                        </a>
                      ) : null}
                      {politician.district ? (
                        <Link
                          href={`/${encodeURIComponent(politician.district.provinceCode.toLowerCase())}/${encodeURIComponent(politician.district.slug)}/politicians`}
                          className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:border-slate-300"
                        >
                          District
                        </Link>
                      ) : null}
                    </div>

                    {(politician.contact.email || politician.contact.website || politician.lastScrapeAt) ? (
                      <p className="mt-3 text-xs text-slate-500">
                        {politician.contact.email ?? 'No public email'}
                        {politician.contact.website ? ` · ${politician.contact.website}` : ''}
                        {politician.lastScrapeAt ? ` · Updated ${new Date(politician.lastScrapeAt).toLocaleString()}` : ''}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="surface-card space-y-4 px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">District associations</h2>
          <p className="mt-1 text-sm text-slate-600">Imported from Elections Canada.</p>
        </div>

        {payload?.associations?.length ? (
          <ul className="space-y-3">
            {payload.associations.map((association) => (
              <li key={association.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <p className="text-base font-semibold text-slate-900">{association.associationName}</p>
                <p className="mt-1 text-sm text-slate-600">
                  <Link href={`/${encodeURIComponent(association.provinceCode.toLowerCase())}/${encodeURIComponent(association.communitySlug)}/politicians`} className="font-semibold text-[var(--cc-primary)] hover:underline">
                    {association.provinceCode.toUpperCase()} / {association.communitySlug}
                  </Link>
                  {association.registrationStatus ? ` · ${association.registrationStatus}` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          status === 'ready' ? <p className="text-sm text-slate-500">No district associations found for this party.</p> : null
        )}
      </section>
    </DashboardShell>
  )
}