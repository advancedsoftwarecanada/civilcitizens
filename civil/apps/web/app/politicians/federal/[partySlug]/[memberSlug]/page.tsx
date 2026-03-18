'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import DashboardShell from '../../../../_components/DashboardShell'
import PoliticianContactCard from '../../../../_components/PoliticianContactCard'
import { buildApiUrl } from '../../../../_lib/api'

type PageProps = {
  params: {
    partySlug: string
    memberSlug: string
  }
}

type FederalMemberResponse = {
  politician?: {
    id: string
    slug: string
    displayName: string
    firstName: string | null
    lastName: string | null
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
    party?: {
      id: string
      slug: string
      name: string
      shortName: string | null
    } | null
    district?: {
      code: number
      slug: string
      name: string
      provinceCode: string
    } | null
  }
}

export default function FederalMemberPage({ params }: PageProps) {
  const [payload, setPayload] = useState<FederalMemberResponse | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setStatus('loading')
      try {
        const res = await fetch(
          buildApiUrl(`/politicians/federal/${encodeURIComponent(params.partySlug)}/${encodeURIComponent(params.memberSlug)}`),
          { cache: 'no-store' },
        )
        if (!res.ok) throw new Error('request_failed')
        const data = (await res.json().catch(() => null)) as FederalMemberResponse | null
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
  }, [params.memberSlug, params.partySlug])

  const politician = payload?.politician ?? null

  return (
    <DashboardShell mainClassName="space-y-6">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Politician</p>
        <h1 className="text-2xl font-semibold text-slate-900">{politician?.displayName ?? params.memberSlug}</h1>
        <p className="text-sm text-slate-600">Federal politician profile.</p>
      </section>

      <section className="surface-card px-6 py-5">
        {status === 'loading' ? <p className="text-sm text-slate-500">Loading member profile…</p> : null}
        {status === 'error' ? <p className="text-sm text-rose-600">This politician profile is not available yet.</p> : null}

        {politician ? (
          <div className="space-y-4">
            <PoliticianContactCard
              displayName={politician.displayName}
              partyName={politician.party?.shortName ?? politician.party?.name ?? null}
              officeType={politician.officeType}
              districtName={politician.district?.name ?? null}
              photoUrl={politician.photoUrl}
              profileUrl={politician.profileUrl}
              xmlUrl={politician.xmlUrl}
              email={politician.contact.email}
              website={politician.contact.website}
              hillOffice={politician.contact.hillOffice}
              constituencyOffices={politician.contact.constituencyOffices}
              lastScrapeAt={politician.lastScrapeAt}
              lastXmlSyncAt={politician.lastXmlSyncAt}
              lastHtmlSyncAt={politician.lastHtmlSyncAt}
            />

            <div className="space-y-2 text-sm text-slate-700">
              <p><span className="font-semibold text-slate-900">Party:</span> {politician.party?.shortName ?? politician.party?.name ?? 'Unassigned'}</p>
              <p><span className="font-semibold text-slate-900">Office:</span> {politician.officeType ?? 'Pending scrape'}</p>
              <p><span className="font-semibold text-slate-900">District:</span> {politician.district?.name ?? 'Pending scrape'}</p>
              <p><span className="font-semibold text-slate-900">Last scrape:</span> {politician.lastScrapeAt ? new Date(politician.lastScrapeAt).toLocaleString() : 'Never'}</p>
            </div>

            {politician.district ? (
              <p>
                <Link href={`/${encodeURIComponent(politician.district.provinceCode.toLowerCase())}/${encodeURIComponent(politician.district.slug)}/politicians`} className="font-semibold text-[var(--cc-primary)] hover:underline">
                  Open district page
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </DashboardShell>
  )
}