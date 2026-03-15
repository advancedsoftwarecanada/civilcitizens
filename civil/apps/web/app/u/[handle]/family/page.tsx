"use client"

import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../../_components/DashboardShell'
import { RightRail } from '../../../_components/RightRail'
import { buildApiUrl } from '../../../_lib/api'
import ProfileRelationshipCard from '../_components/ProfileRelationshipCard'

type PageProps = {
  params: {
    handle: string
  }
}

type FamilyProfileEntry = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
  relationshipLabel: string
}

type GuardianEntry = {
  id: string
  handle: string | null
  name: string
  avatarUrl: string | null
  coverUrl: string | null
  relationshipLabel: string
}

type FamilyPageResponse = {
  userHandle?: string
  immediateFamily?: FamilyProfileEntry[]
  guardianOf?: GuardianEntry[]
  extendedFamily?: FamilyProfileEntry[]
}

function Section({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string
  subtitle: string
  empty: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4 rounded-[28px] border border-white/60 bg-white/90 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.10)] sm:p-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      {children || <p className="text-sm text-slate-500">{empty}</p>}
    </section>
  )
}

export default function UserFamilyPage({ params }: PageProps) {
  const handle = decodeURIComponent(params.handle)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<FamilyPageResponse | null>(null)

  useEffect(() => {
    let canceled = false

    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(buildApiUrl(`/users/${encodeURIComponent(handle)}/family`), { cache: 'no-store' })
        if (!response.ok) {
          if (!canceled) {
            setError(response.status === 404 ? 'Profile not found.' : 'Unable to load Family right now.')
            setData(null)
          }
          return
        }

        const payload = (await response.json().catch(() => null)) as FamilyPageResponse | null
        if (!canceled) {
          setData(payload)
        }
      } catch (err) {
        console.error('Failed to load user family page', err)
        if (!canceled) {
          setError('Unable to load Family right now.')
          setData(null)
        }
      } finally {
        if (!canceled) {
          setLoading(false)
        }
      }
    }

    void run()
    return () => {
      canceled = true
    }
  }, [handle])

  const immediateFamily = useMemo(() => (Array.isArray(data?.immediateFamily) ? data.immediateFamily : []), [data])
  const guardianOf = useMemo(() => (Array.isArray(data?.guardianOf) ? data.guardianOf : []), [data])
  const extendedFamily = useMemo(() => (Array.isArray(data?.extendedFamily) ? data.extendedFamily : []), [data])

  return (
    <DashboardShell rightRail={<RightRail />}>
      <div className="space-y-6">
        {loading ? <div className="rounded-[28px] border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">Loading Family…</div> : null}
        {!loading && error ? <div className="rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div> : null}

        {!loading && !error ? (
          <>
            <Section title="Immediate Family" subtitle="Core household and closest relatives." empty="No immediate family added yet.">
              {immediateFamily.length ? (
                <div className="grid gap-4">
                  {immediateFamily.map((entry) => (
                    <ProfileRelationshipCard
                      key={entry.id}
                      userId={entry.id}
                      handle={entry.handle}
                      name={entry.name}
                      avatarUrl={entry.avatarUrl}
                      coverUrl={entry.coverUrl}
                      contextLabel="Family"
                      relationshipLabel={entry.relationshipLabel}
                    />
                  ))}
                </div>
              ) : null}
            </Section>

            <Section title="Guardian Of" subtitle="Family profiles under this account's care." empty="No Guardian relationships yet.">
              {guardianOf.length ? (
                <div className="grid gap-4">
                  {guardianOf.map((entry) => (
                    <ProfileRelationshipCard
                      key={entry.id}
                      handle={entry.handle}
                      name={entry.name}
                      avatarUrl={entry.avatarUrl}
                      coverUrl={entry.coverUrl}
                      contextLabel="Family"
                      relationshipLabel={entry.relationshipLabel}
                      interactive={Boolean(entry.handle)}
                    />
                  ))}
                </div>
              ) : null}
            </Section>

            <Section title="Extended Family" subtitle="Extended and in-law relationships." empty="No extended family added yet.">
              {extendedFamily.length ? (
                <div className="grid gap-4">
                  {extendedFamily.map((entry) => (
                    <ProfileRelationshipCard
                      key={entry.id}
                      userId={entry.id}
                      handle={entry.handle}
                      name={entry.name}
                      avatarUrl={entry.avatarUrl}
                      coverUrl={entry.coverUrl}
                      contextLabel="Family"
                      relationshipLabel={entry.relationshipLabel}
                    />
                  ))}
                </div>
              ) : null}
            </Section>
          </>
        ) : null}
      </div>
    </DashboardShell>
  )
}
