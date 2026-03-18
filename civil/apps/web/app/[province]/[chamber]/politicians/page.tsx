'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import DashboardShell from '../../../_components/DashboardShell'
import CommunityRightRailClient from '../../../_components/CommunityRightRailClient'
import PoliticianContactCard from '../../../_components/PoliticianContactCard'
import { buildApiUrl } from '../../../_lib/api'
import { getProvinceDisplayName, normalizeProvinceCode } from '@civil/shared'

type PageProps = {
  params: {
    province: string
    chamber: string
  }
}

type CommunityPoliticiansResponse = {
  community?: {
    provinceCode: string
    communitySlug: string
    name: string
  }
  federal?: {
    seat?: {
      title: string
      politician?: {
        id: string
        slug: string
        displayName: string
        lastScrapeAt: string | null
        profileUrl: string | null
        xmlUrl: string | null
        photoUrl: string | null
        lastXmlSyncAt: string | null
        lastHtmlSyncAt: string | null
        contact: {
          email: string | null
          website: string | null
          hillOffice: {
            label: string | null
            lines: string[]
            telephone: string | null
            fax: string | null
          } | null
          constituencyOffices: Array<{
            label: string | null
            lines: string[]
            telephone: string | null
            fax: string | null
          }>
        }
      } | null
      party?: {
        id: string
        slug: string
        name: string
        shortName: string | null
      } | null
      lastScrapeAt: string | null
    } | null
    associations?: Array<{
      id: string
      associationName: string
      registrationStatus: string | null
      registeredAt: string | null
      deregisteredAt: string | null
      party: {
        id: string
        slug: string
        name: string
        shortName: string | null
      }
    }>
  }
}

export default function CommunityPoliticiansPage({ params }: PageProps) {
  const [payload, setPayload] = useState<CommunityPoliticiansResponse | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const provinceName = useMemo(() => {
    const normalized = normalizeProvinceCode(params.province)
    return (normalized ? getProvinceDisplayName(normalized) : null) || params.province.toUpperCase()
  }, [params.province])

  const communityName = useMemo(() => {
    return params.chamber
      .split('-')
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ')
  }, [params.chamber])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setStatus('loading')
      try {
        const res = await fetch(
          buildApiUrl(`/communities/${encodeURIComponent(params.province)}/${encodeURIComponent(params.chamber)}/politicians`),
          { cache: 'no-store' },
        )
        if (!res.ok) throw new Error('request_failed')
        const data = (await res.json().catch(() => null)) as CommunityPoliticiansResponse | null
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
  }, [params.chamber, params.province])

  const federalSeat = payload?.federal?.seat ?? null
  const associations = payload?.federal?.associations ?? []

  return (
    <DashboardShell
      rightRail={<CommunityRightRailClient province={params.province} municipality={params.chamber} />}
      mainClassName="space-y-6"
    >
      <section>
        <h1 className="text-2xl font-semibold text-slate-900">{communityName}</h1>
      </section>

      <section className="surface-card space-y-4 px-6 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Federal Seat</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">Member of Parliament</h2>
        </div>

        {status === 'loading' ? <p className="text-sm text-slate-500">Loading federal seat…</p> : null}
        {status === 'error' ? <p className="text-sm text-rose-600">Unable to load this district’s politician data.</p> : null}

        {status === 'ready' ? (
          federalSeat?.politician ? (
            <div className="space-y-4">
              <PoliticianContactCard
                displayName={federalSeat.politician.displayName}
                partyName={federalSeat.party?.shortName ?? federalSeat.party?.name ?? null}
                officeType={federalSeat.title}
                districtName={payload?.community?.name ?? communityName}
                photoUrl={federalSeat.politician.photoUrl}
                profileUrl={federalSeat.politician.profileUrl}
                xmlUrl={federalSeat.politician.xmlUrl}
                email={federalSeat.politician.contact.email}
                website={federalSeat.politician.contact.website}
                hillOffice={federalSeat.politician.contact.hillOffice}
                constituencyOffices={federalSeat.politician.contact.constituencyOffices}
                lastScrapeAt={federalSeat.politician.lastScrapeAt}
                lastXmlSyncAt={federalSeat.politician.lastXmlSyncAt}
                lastHtmlSyncAt={federalSeat.politician.lastHtmlSyncAt}
              />

            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Pending scrape</p>
              <p className="mt-2 text-sm text-slate-600">
                The seat placeholder exists, but the current MP still needs to be scraped into the politicians database.
              </p>
            </div>
          )
        ) : null}
      </section>

      <section className="surface-card space-y-4 px-6 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Federal District Associations</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">Parties in this riding</h2>
        </div>

        {status === 'ready' && !associations.length ? <p className="text-sm text-slate-500">No federal party associations imported for this district yet.</p> : null}

        {associations.length ? (
          <ul className="space-y-3">
            {associations.map((association) => (
              <li key={association.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-slate-900">{association.associationName}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      <Link href={`/politicians/federal/${encodeURIComponent(association.party.slug)}`} className="font-semibold text-[var(--cc-primary)] hover:underline">
                        {association.party.shortName ?? association.party.name}
                      </Link>
                      {association.registrationStatus ? ` · ${association.registrationStatus}` : ''}
                    </p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Federal
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </DashboardShell>
  )
}