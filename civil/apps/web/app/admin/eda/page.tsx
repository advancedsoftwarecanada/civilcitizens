'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AdminWideShell from '../_components/AdminWideShell'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { clearAuthSession } from '../../_lib/authSession'
import { useAdminAccess } from '../_hooks/useAdminAccess'

type DatasetSource = {
  key: string
  label: string
  jurisdiction: string
  officeType: string
  available: boolean
  updatedAt: string | null
}

type DatasetStat = {
  count: number
  lastUpdatedAt: string | null
}

type ScrapeJobStat = DatasetStat & {
  queued: number
  processing: number
  completed: number
  failed: number
}

type ScrapeJobSourceStat = ScrapeJobStat

type CommonsCoverageStat = {
  currentMembers: number
  occupiedSeats: number
  vacantSeats: number
  politiciansWithProfileUrl: number
  xmlSynced: number
  htmlSynced: number
  photos: number
  emails: number
  websites: number
  hillOffices: number
  constituencyOffices: number
  remainingXmlSync: number
  remainingHtmlSync: number
  lastXmlSyncAt: string | null
  lastHtmlSyncAt: string | null
  status: 'up_to_date' | 'in_progress' | 'attention' | 'needs_refresh'
}

type PpcRidingAlias = {
  provinceCode: string
  provinceName: string
  sourceRidingName: string
  targetRidingName: string
  targetCommunitySlug: string
  targetElectoralDistrictCode: number | null
  databaseBacked: boolean
  note: string | null
}

type AdminEdaResponse = {
  generatedAt: string
  databaseReady: boolean
  sources: DatasetSource[]
  byElections: AdminByElectionEntry[]
  ppcRidingAliases: PpcRidingAlias[]
  stats: {
    parties: DatasetStat
    associations: DatasetStat
    seats: DatasetStat & { occupied: number; vacant: number }
    politicians: DatasetStat
    scrapeJobs: ScrapeJobStat & {
      xml: ScrapeJobSourceStat
      html: ScrapeJobSourceStat
    }
    commonsCoverage: CommonsCoverageStat
  }
}

type ImportSummary = {
  sourceKey: string
  importedAt: string
  rowsProcessed: number
  unresolvedRows: number
  unresolvedSample: Array<{ districtName: string; associationName: string; reason: string }>
  partiesCreated: number
  partiesUpdated: number
  associationsCreated: number
  associationsUpdated: number
  seatsCreated: number
  seatsUpdated: number
}

type ImportResponse = {
  ok: boolean
  summary: ImportSummary
  stats: AdminEdaResponse['stats']
}

type FederalMemberFetchSummary = {
  importedAt: string
  provincesProcessed: number
  membersProcessed: number
  unresolvedMembers: number
  unresolvedSample: Array<{ personId: string; constituencyName: string; reason: string }>
  partiesCreated: number
  partiesUpdated: number
  politiciansCreated: number
  politiciansUpdated: number
  seatsCreated: number
  seatsUpdated: number
  scrapeJobsCreated: number
  scrapeJobsRequeued: number
}

type FederalMemberFetchResponse = {
  ok: boolean
  summary: FederalMemberFetchSummary
  stats: AdminEdaResponse['stats']
}

type FederalMemberDetailFetchSummary = {
  enqueuedAt: string
  politiciansConsidered: number
  jobsCreated: number
  jobsRequeued: number
  jobsAlreadyQueued: number
  skippedMissingProfileUrl: number
}

type FederalMemberDetailFetchResponse = {
  ok: boolean
  summary: FederalMemberDetailFetchSummary
  stats: AdminEdaResponse['stats']
}

type PpcCandidateFetchSummary = {
  importedAt: string
  sourceUrl: string
  cardsFound: number
  matchedDistricts: number
  politiciansCreated: number
  politiciansUpdated: number
  unmatchedCards: number
  unmatchedSample: Array<{
    displayName: string
    ridingName: string
    provinceName: string
    reason: string
  }>
}

type PpcCandidateFetchResponse = {
  ok: boolean
  summary: PpcCandidateFetchSummary
  stats: AdminEdaResponse['stats']
}

type ProvinceOption = {
  code: string
  name: string
}

type CommunityOption = {
  slug: string
  province: string
  name?: string
}

type ItemsResponse<T> = {
  items?: T[]
}

type ByElectionStatusValue = 'draft' | 'published' | 'completed'

type AdminByElectionEntry = {
  id: string
  provinceCode: string
  provinceName: string
  communitySlug: string
  communityName: string
  status: ByElectionStatusValue
  title: string
  tagline: string | null
  electionsCanadaUrl: string | null
  electionDayAt: string | null
  electionDayLabel: string | null
  advanceVotingLabel: string | null
  electionDayHoursLabel: string | null
  updatedAt: string
}

type Status = 'idle' | 'loading' | 'ready' | 'error'

const provincesFallback: ProvinceOption[] = [
  { code: 'nl', name: 'Newfoundland and Labrador' },
  { code: 'pe', name: 'Prince Edward Island' },
  { code: 'ns', name: 'Nova Scotia' },
  { code: 'nb', name: 'New Brunswick' },
  { code: 'qc', name: 'Quebec' },
  { code: 'on', name: 'Ontario' },
  { code: 'mb', name: 'Manitoba' },
  { code: 'sk', name: 'Saskatchewan' },
  { code: 'ab', name: 'Alberta' },
  { code: 'bc', name: 'British Columbia' },
  { code: 'yt', name: 'Yukon' },
  { code: 'nt', name: 'Northwest Territories' },
  { code: 'nu', name: 'Nunavut' },
]

export default function AdminEdaPage() {
  const { token, loading: accessLoading, error: accessError, isSuperAdmin } = useAdminAccess()
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [sources, setSources] = useState<DatasetSource[]>([])
  const [byElections, setByElections] = useState<AdminByElectionEntry[]>([])
  const [stats, setStats] = useState<AdminEdaResponse['stats'] | null>(null)
  const [databaseReady, setDatabaseReady] = useState(true)
  const [selectedSource, setSelectedSource] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [runningCommonsFetch, setRunningCommonsFetch] = useState(false)
  const [runningMemberDetailFetch, setRunningMemberDetailFetch] = useState(false)
  const [runningPpcCandidateFetch, setRunningPpcCandidateFetch] = useState(false)
  const [manualProvinces, setManualProvinces] = useState<ProvinceOption[]>(provincesFallback)
  const [manualProvinceCode, setManualProvinceCode] = useState('')
  const [manualCommunities, setManualCommunities] = useState<CommunityOption[]>([])
  const [manualToolsOpen, setManualToolsOpen] = useState(false)
  const [loadingManualCommunities, setLoadingManualCommunities] = useState(false)
  const [savingByElection, setSavingByElection] = useState(false)
  const [editingByElectionId, setEditingByElectionId] = useState<string | null>(null)
  const [byElectionForm, setByElectionForm] = useState({
    communitySlug: '',
    status: 'draft' as ByElectionStatusValue,
    title: '',
    tagline: '',
    electionsCanadaUrl: '',
    electionDayAt: '',
    electionDayLabel: '',
    advanceVotingLabel: '',
    electionDayHoursLabel: '',
  })
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [commonsSummary, setCommonsSummary] = useState<FederalMemberFetchSummary | null>(null)
  const [memberDetailSummary, setMemberDetailSummary] = useState<FederalMemberDetailFetchSummary | null>(null)
  const [ppcCandidateSummary, setPpcCandidateSummary] = useState<PpcCandidateFetchSummary | null>(null)
  const [ppcRidingAliases, setPpcRidingAliases] = useState<PpcRidingAlias[]>([])

  const numberFormatter = useMemo(() => new Intl.NumberFormat('en-CA'), [])
  const byElectionStatusLabel = useCallback((value: ByElectionStatusValue) => {
    switch (value) {
      case 'published':
        return 'Published'
      case 'completed':
        return 'Completed'
      case 'draft':
      default:
        return 'Draft'
    }
  }, [])
  const statusCopy = useMemo(
    () => ({
      up_to_date: {
        label: 'Up to date',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        description: 'All imported Commons members have both XML and member-detail enrichment.',
      },
      in_progress: {
        label: 'Catching up',
        className: 'border-sky-200 bg-sky-50 text-sky-700',
        description: 'Background scrape work is still queued or processing.',
      },
      attention: {
        label: 'Needs attention',
        className: 'border-rose-200 bg-rose-50 text-rose-700',
        description: 'At least one scrape job failed and needs review or requeueing.',
      },
      needs_refresh: {
        label: 'Not current',
        className: 'border-amber-200 bg-amber-50 text-amber-700',
        description: 'The import is present, but some members have not been enriched yet.',
      },
    }),
    [],
  )

  const activeByElections = useMemo(
    () => byElections.filter((item) => item.status !== 'completed'),
    [byElections],
  )

  const load = useCallback(async () => {
    if (!token) return
    setStatus('loading')
    setError(null)
    try {
      const res = await fetch(buildApiUrl('/admin/eda'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (res.status === 401) {
        clearAuthSession()
        redirectToAuthModal('login')
        return
      }
      if (res.status === 403) {
        setStatus('error')
        setError('Admin access denied for this account.')
        return
      }
      if (!res.ok) {
        setStatus('error')
        setError('Unable to load EDA import tools right now.')
        return
      }

      const payload = (await res.json()) as AdminEdaResponse
      setDatabaseReady(payload.databaseReady !== false)
      setSources(payload.sources ?? [])
      setByElections(Array.isArray(payload.byElections) ? payload.byElections : [])
      setPpcRidingAliases(Array.isArray(payload.ppcRidingAliases) ? payload.ppcRidingAliases : [])
      setStats(payload.stats ?? null)
      setSelectedSource((current) => current || payload.sources.find((source) => source.available)?.key || '')
      setStatus('ready')
    } catch (loadError) {
      console.error('[admin/eda] Failed to load tools', loadError)
      setStatus('error')
      setError('Unexpected error while loading EDA tools.')
    }
  }, [token])

  useEffect(() => {
    if (!isSuperAdmin || !token) return
    void load()
  }, [isSuperAdmin, load, token])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch(buildApiUrl('/communities/provinces'), {
          cache: 'no-store',
        })
        if (!res.ok) return
        const payload = (await res.json().catch(() => null)) as ItemsResponse<ProvinceOption> | null
        if (!cancelled && Array.isArray(payload?.items) && payload.items.length) {
          setManualProvinces(payload.items)
        }
      } catch {
        if (!cancelled) {
          setManualProvinces(provincesFallback)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!manualProvinceCode) {
      setManualCommunities([])
      setByElectionForm((current) => ({ ...current, communitySlug: '' }))
      return
    }

    let cancelled = false
    setLoadingManualCommunities(true)

    void (async () => {
      try {
        const res = await fetch(buildApiUrl(`/communities/${encodeURIComponent(manualProvinceCode)}`), {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error('communities_failed')
        const payload = (await res.json().catch(() => null)) as ItemsResponse<CommunityOption> | null
        const items = Array.isArray(payload?.items) ? payload.items : []
        if (!cancelled) {
          setManualCommunities(items)
          setByElectionForm((current) => {
            if (!current.communitySlug) return current
            return items.some((item) => item.slug === current.communitySlug)
              ? current
              : { ...current, communitySlug: '' }
          })
        }
      } catch {
        if (!cancelled) {
          setManualCommunities([])
          setByElectionForm((current) => ({ ...current, communitySlug: '' }))
        }
      } finally {
        if (!cancelled) {
          setLoadingManualCommunities(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [manualProvinceCode])

  const resetByElectionForm = useCallback(() => {
    setEditingByElectionId(null)
    setManualProvinceCode('')
    setManualCommunities([])
    setByElectionForm({
      communitySlug: '',
      status: 'draft',
      title: '',
      tagline: '',
      electionsCanadaUrl: '',
      electionDayAt: '',
      electionDayLabel: '',
      advanceVotingLabel: '',
      electionDayHoursLabel: '',
    })
  }, [])

  const startEditingByElection = useCallback((entry: AdminByElectionEntry) => {
    setManualToolsOpen(true)
    setEditingByElectionId(entry.id)
    setManualProvinceCode(entry.provinceCode)
    setByElectionForm({
      communitySlug: entry.communitySlug,
      status: entry.status,
      title: entry.title,
      tagline: entry.tagline ?? '',
      electionsCanadaUrl: entry.electionsCanadaUrl ?? '',
      electionDayAt: entry.electionDayAt ? entry.electionDayAt.slice(0, 10) : '',
      electionDayLabel: entry.electionDayLabel ?? '',
      advanceVotingLabel: entry.advanceVotingLabel ?? '',
      electionDayHoursLabel: entry.electionDayHoursLabel ?? '',
    })
  }, [])

  const saveByElection = useCallback(async () => {
    if (!token || !manualProvinceCode || !byElectionForm.communitySlug || !byElectionForm.title.trim()) return
    setSavingByElection(true)
    setError(null)
    try {
      const res = await fetch(
        buildApiUrl(
          editingByElectionId
            ? `/admin/eda/by-elections/${encodeURIComponent(editingByElectionId)}`
            : '/admin/eda/by-elections',
        ),
        {
          method: editingByElectionId ? 'PATCH' : 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            provinceCode: manualProvinceCode,
            communitySlug: byElectionForm.communitySlug,
            status: byElectionForm.status,
            title: byElectionForm.title,
            tagline: byElectionForm.tagline,
            electionsCanadaUrl: byElectionForm.electionsCanadaUrl,
            electionDayAt: byElectionForm.electionDayAt,
            electionDayLabel: byElectionForm.electionDayLabel,
            advanceVotingLabel: byElectionForm.advanceVotingLabel,
            electionDayHoursLabel: byElectionForm.electionDayHoursLabel,
          }),
        },
      )

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        setError(
          payload?.error === 'by_election_conflict'
            ? 'There is already a manual by-election entry for that riding.'
            : payload?.error === 'political_tables_not_ready'
              ? 'Political tables are not ready in this environment yet. Run the new Prisma migration first.'
              : payload?.error ?? 'Unable to save the by-election entry.',
        )
        return
      }

      await load()
      resetByElectionForm()
    } catch (saveError) {
      console.error('[admin/eda] Save by-election failed', saveError)
      setError('Unable to save the by-election entry.')
    } finally {
      setSavingByElection(false)
    }
  }, [byElectionForm, editingByElectionId, load, manualProvinceCode, resetByElectionForm, token])

  const runImport = useCallback(async () => {
    if (!token || !selectedSource) return
    setRunning(true)
    setError(null)
    try {
      const res = await fetch(buildApiUrl('/admin/eda/import'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ sourceKey: selectedSource }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        setError(payload?.error === 'political_tables_not_ready' ? 'Political tables are not ready in this environment yet. Run the new Prisma migration first.' : payload?.error ?? 'Unable to run the EDA import.')
        return
      }

      const payload = (await res.json()) as ImportResponse
      setSummary(payload.summary)
      setStats(payload.stats)
      await load()
    } catch (runError) {
      console.error('[admin/eda] Import failed', runError)
      setError('Unable to run the EDA import.')
    } finally {
      setRunning(false)
    }
  }, [load, selectedSource, token])

  const runCommonsFetch = useCallback(async () => {
    if (!token) return
    setRunningCommonsFetch(true)
    setError(null)
    try {
      const res = await fetch(buildApiUrl('/admin/eda/federal-members/fetch'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null
        setError(
          payload?.error === 'political_tables_not_ready'
            ? 'Political tables are not ready in this environment yet. Run the new Prisma migration first.'
            : payload?.detail ?? payload?.error ?? 'Unable to fetch federal member data.',
        )
        return
      }

      const payload = (await res.json()) as FederalMemberFetchResponse
      setCommonsSummary(payload.summary)
      setStats(payload.stats)
      await load()
    } catch (runError) {
      console.error('[admin/eda] Commons fetch failed', runError)
      setError('Unable to fetch federal member data.')
    } finally {
      setRunningCommonsFetch(false)
    }
  }, [load, token])

  const runMemberDetailFetch = useCallback(async () => {
    if (!token) return
    setRunningMemberDetailFetch(true)
    setError(null)
    try {
      const res = await fetch(buildApiUrl('/admin/eda/federal-members/details/fetch'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null
        setError(
          payload?.error === 'political_tables_not_ready'
            ? 'Political tables are not ready in this environment yet. Run the new Prisma migration first.'
            : payload?.detail ?? payload?.error ?? 'Unable to fetch member details.',
        )
        return
      }

      const payload = (await res.json()) as FederalMemberDetailFetchResponse
      setMemberDetailSummary(payload.summary)
      setStats(payload.stats)
      await load()
    } catch (runError) {
      console.error('[admin/eda] Member detail fetch failed', runError)
      setError('Unable to fetch member details.')
    } finally {
      setRunningMemberDetailFetch(false)
    }
  }, [load, token])

  const runPpcCandidateFetch = useCallback(async () => {
    if (!token) return
    setRunningPpcCandidateFetch(true)
    setError(null)
    try {
      const res = await fetch(buildApiUrl('/admin/eda/federal-candidates/ppc/fetch'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null
        setError(
          payload?.error === 'political_tables_not_ready'
            ? 'Political tables are not ready in this environment yet. Run the new Prisma migration first.'
            : payload?.detail ?? payload?.error ?? 'Unable to fetch PPC candidates.',
        )
        return
      }

      const payload = (await res.json()) as PpcCandidateFetchResponse
      setPpcCandidateSummary(payload.summary)
      setStats(payload.stats)
      await load()
    } catch (runError) {
      console.error('[admin/eda] PPC candidate scrape failed', runError)
      setError('Unable to fetch PPC candidates.')
    } finally {
      setRunningPpcCandidateFetch(false)
    }
  }, [load, token])

  const body = () => {
    if (accessLoading) {
      return <div className="surface-card p-6 text-sm text-slate-500">Loading EDA data tools…</div>
    }
    if (!isSuperAdmin) {
      return (
        <div className="surface-card border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
          {accessError ?? 'Admin access is limited to root operators.'}
        </div>
      )
    }
    if (status === 'loading' || status === 'idle') {
      return <div className="surface-card p-6 text-sm text-slate-500">Loading EDA data tools…</div>
    }
    if (status === 'error') {
      return <div className="surface-card border border-rose-200 bg-rose-50 p-6 text-sm text-rose-600">{error}</div>
    }

    return (
      <>
        <section className="surface-card space-y-3 px-6 py-5 shadow-subtle">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">EDA Data</p>
          <h1 className="text-2xl font-semibold text-slate-900">Update politicians</h1>
          <p className="text-sm text-slate-600">
            Import Elections Canada riding-party records, sync current House of Commons members province by province, and queue detail scraping for enrichment.
          </p>
        </section>

        <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
          {!databaseReady ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              The political tables are not available in this database yet. Run the new Prisma migration, then reload this page.
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] xl:items-end">
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Data source
              <select
                value={selectedSource}
                onChange={(event) => setSelectedSource(event.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
              >
                <option value="">Select a data source</option>
                {sources.map((source) => (
                  <option key={source.key} value={source.key} disabled={!source.available}>
                    {source.label}
                    {!source.available ? ' (missing file)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => void runImport()}
              disabled={running || !selectedSource || !databaseReady}
              className="rounded-full bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running ? 'Updating…' : 'Update Politicians'}
            </button>

            <button
              type="button"
              onClick={() => void runCommonsFetch()}
              disabled={runningCommonsFetch || !databaseReady}
              className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runningCommonsFetch ? 'Fetching…' : 'Fetch provincial data'}
            </button>

            <button
              type="button"
              onClick={() => void runMemberDetailFetch()}
              disabled={runningMemberDetailFetch || !databaseReady}
              className="rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runningMemberDetailFetch ? 'Fetching…' : 'Fetch member details'}
            </button>

            <button
              type="button"
              onClick={() => void runPpcCandidateFetch()}
              disabled={runningPpcCandidateFetch || !databaseReady}
              className="rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runningPpcCandidateFetch ? 'Scraping…' : 'Scrape PPC candidates'}
            </button>
          </div>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {stats
              ? [
                  { label: 'Parties', value: stats.parties.count, updatedAt: stats.parties.lastUpdatedAt },
                  { label: 'District associations', value: stats.associations.count, updatedAt: stats.associations.lastUpdatedAt },
                  {
                    label: 'Federal seats',
                    value: stats.seats.count,
                    updatedAt: stats.seats.lastUpdatedAt,
                    detail: `${numberFormatter.format(stats.seats.occupied)} occupied, ${numberFormatter.format(stats.seats.vacant)} vacant`,
                  },
                  { label: 'Politicians', value: stats.politicians.count, updatedAt: stats.politicians.lastUpdatedAt },
                  {
                    label: 'Scrape jobs',
                    value: stats.scrapeJobs.count,
                    updatedAt: stats.scrapeJobs.lastUpdatedAt,
                    detail: `XML ${numberFormatter.format(stats.scrapeJobs.xml.completed)} complete, HTML ${numberFormatter.format(stats.scrapeJobs.html.completed)} complete`,
                  },
                ].map((item) => (
                  <article key={item.label} className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-subtle">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{item.label}</p>
                    <p className="mt-2 text-3xl font-semibold text-slate-900">{numberFormatter.format(item.value)}</p>
                    {'detail' in item && item.detail ? <p className="mt-2 text-xs text-slate-600">{item.detail}</p> : null}
                    <p className="mt-2 text-xs text-slate-500">
                      {item.updatedAt ? `Updated ${new Date(item.updatedAt).toLocaleString()}` : 'Awaiting first import'}
                    </p>
                  </article>
                ))
              : null}
          </div>

          {stats ? (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">Commons freshness</p>
                  <p className="mt-1 text-slate-600">{statusCopy[stats.commonsCoverage.status].description}</p>
                </div>
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusCopy[stats.commonsCoverage.status].className}`}
                >
                  {statusCopy[stats.commonsCoverage.status].label}
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="font-semibold text-slate-900">XML sync coverage</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {numberFormatter.format(stats.commonsCoverage.xmlSynced)} / {numberFormatter.format(stats.commonsCoverage.currentMembers)}
                  </p>
                  <p className="mt-2 text-xs text-slate-600">
                    Remaining {numberFormatter.format(stats.commonsCoverage.remainingXmlSync)}
                    {stats.commonsCoverage.lastXmlSyncAt ? ` • Last sync ${new Date(stats.commonsCoverage.lastXmlSyncAt).toLocaleString()}` : ''}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Queued {numberFormatter.format(stats.scrapeJobs.xml.queued)} | Processing {numberFormatter.format(stats.scrapeJobs.xml.processing)} | Failed {numberFormatter.format(stats.scrapeJobs.xml.failed)}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="font-semibold text-slate-900">Member detail coverage</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {numberFormatter.format(stats.commonsCoverage.htmlSynced)} / {numberFormatter.format(stats.commonsCoverage.currentMembers)}
                  </p>
                  <p className="mt-2 text-xs text-slate-600">
                    Remaining {numberFormatter.format(stats.commonsCoverage.remainingHtmlSync)}
                    {stats.commonsCoverage.lastHtmlSyncAt ? ` • Last sync ${new Date(stats.commonsCoverage.lastHtmlSyncAt).toLocaleString()}` : ''}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Queued {numberFormatter.format(stats.scrapeJobs.html.queued)} | Processing {numberFormatter.format(stats.scrapeJobs.html.processing)} | Failed {numberFormatter.format(stats.scrapeJobs.html.failed)}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="font-semibold text-slate-900">Seat occupancy</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {numberFormatter.format(stats.commonsCoverage.occupiedSeats)} / {numberFormatter.format(stats.seats.count)}
                  </p>
                  <p className="mt-2 text-xs text-slate-600">
                    {numberFormatter.format(stats.commonsCoverage.vacantSeats)} vacant seat{stats.commonsCoverage.vacantSeats === 1 ? '' : 's'}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Profile URLs for {numberFormatter.format(stats.commonsCoverage.politiciansWithProfileUrl)} member{stats.commonsCoverage.politiciansWithProfileUrl === 1 ? '' : 's'}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {[
                  { label: 'Photos', value: stats.commonsCoverage.photos },
                  { label: 'Emails', value: stats.commonsCoverage.emails },
                  { label: 'Websites', value: stats.commonsCoverage.websites },
                  { label: 'Hill offices', value: stats.commonsCoverage.hillOffices },
                  { label: 'Constituency offices', value: stats.commonsCoverage.constituencyOffices },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{item.label}</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{numberFormatter.format(item.value)}</p>
                  </div>
                ))}
              </div>

              <div>
                <p className="font-semibold text-slate-900">Scrape queue status</p>
                <p className="mt-2">
                  All jobs: queued {numberFormatter.format(stats.scrapeJobs.queued)} | processing {numberFormatter.format(stats.scrapeJobs.processing)} | completed {numberFormatter.format(stats.scrapeJobs.completed)} | failed {numberFormatter.format(stats.scrapeJobs.failed)}
                </p>
              </div>
            </div>
          ) : null}
        </section>

        <section className="surface-card space-y-5 px-6 py-5 shadow-subtle">
          <button
            type="button"
            onClick={() => setManualToolsOpen((current) => !current)}
            className="flex w-full items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white px-5 py-4 text-left transition hover:bg-slate-50"
            aria-expanded={manualToolsOpen}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Manual Tools</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">Upcoming By-Elections</h2>
              <p className="mt-1 text-sm text-slate-600">
                {activeByElections.length} active record{activeByElections.length === 1 ? '' : 's'}
                {editingByElectionId ? ' • Editing entry' : ''}
              </p>
            </div>
            <span
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition ${
                manualToolsOpen ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5 fill-current">
                <path d="M5.2 7.7a.75.75 0 0 1 1.06 0L10 11.44l3.74-3.74a.75.75 0 1 1 1.06 1.06l-4.27 4.27a.75.75 0 0 1-1.06 0L5.2 8.76a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </span>
          </button>

          {manualToolsOpen ? (
            <>
              <div className="flex flex-wrap items-start justify-end gap-3">
                {editingByElectionId ? (
                  <button
                    type="button"
                    onClick={resetByElectionForm}
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Cancel edit
                  </button>
                ) : null}
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <div className="grid gap-4 xl:grid-cols-2">
                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    Province
                    <select
                      value={manualProvinceCode}
                      onChange={(event) => setManualProvinceCode(event.target.value)}
                      disabled={!databaseReady || savingByElection}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    >
                      <option value="">Select a province</option>
                      {manualProvinces.map((province) => (
                        <option key={province.code} value={province.code}>
                          {province.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    Select EDA
                    <select
                      value={byElectionForm.communitySlug}
                      onChange={(event) => setByElectionForm((current) => ({ ...current, communitySlug: event.target.value }))}
                      disabled={!databaseReady || !manualProvinceCode || loadingManualCommunities || savingByElection}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    >
                      <option value="">{loadingManualCommunities ? 'Loading EDAs…' : 'Select an electoral district'}</option>
                      {manualCommunities.map((community) => (
                        <option key={`${community.province}:${community.slug}`} value={community.slug}>
                          {community.name ?? community.slug}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    Status
                    <select
                      value={byElectionForm.status}
                      onChange={(event) => setByElectionForm((current) => ({ ...current, status: event.target.value as ByElectionStatusValue }))}
                      disabled={!databaseReady || savingByElection}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    >
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                      <option value="completed">Completed</option>
                    </select>
                  </label>

                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    Election day date
                    <input
                      type="date"
                      value={byElectionForm.electionDayAt}
                      onChange={(event) => setByElectionForm((current) => ({ ...current, electionDayAt: event.target.value }))}
                      disabled={!databaseReady || savingByElection}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    />
                  </label>

                  <label className="grid gap-2 text-sm font-medium text-slate-700 xl:col-span-2">
                    Elections Canada Information
                    <input
                      type="url"
                      value={byElectionForm.electionsCanadaUrl}
                      onChange={(event) => setByElectionForm((current) => ({ ...current, electionsCanadaUrl: event.target.value }))}
                      disabled={!databaseReady || savingByElection}
                      placeholder="https://www.elections.ca/content.aspx?section=ele&dir=2026/24073&document=index&lang=e"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    />
                  </label>

                  <label className="grid gap-2 text-sm font-medium text-slate-700 xl:col-span-2">
                    Title
                    <input
                      type="text"
                      value={byElectionForm.title}
                      onChange={(event) => setByElectionForm((current) => ({ ...current, title: event.target.value }))}
                      disabled={!databaseReady || savingByElection}
                      placeholder="By-election in Terrebonne (QC)"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    />
                  </label>

                  <label className="grid gap-2 text-sm font-medium text-slate-700 xl:col-span-2">
                    Tagline
                    <input
                      type="text"
                      value={byElectionForm.tagline}
                      onChange={(event) => setByElectionForm((current) => ({ ...current, tagline: event.target.value }))}
                      disabled={!databaseReady || savingByElection}
                      placeholder="It's Our Vote!"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    />
                  </label>

                  <label className="grid gap-2 text-sm font-medium text-slate-700 xl:col-span-2">
                    Election day label
                    <input
                      type="text"
                      value={byElectionForm.electionDayLabel}
                      onChange={(event) => setByElectionForm((current) => ({ ...current, electionDayLabel: event.target.value }))}
                      disabled={!databaseReady || savingByElection}
                      placeholder="Election day: Monday, April 13, 2026"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    />
                  </label>

                  <label className="grid gap-2 text-sm font-medium text-slate-700 xl:col-span-2">
                    Advance voting days
                    <textarea
                      value={byElectionForm.advanceVotingLabel}
                      onChange={(event) => setByElectionForm((current) => ({ ...current, advanceVotingLabel: event.target.value }))}
                      disabled={!databaseReady || savingByElection}
                      rows={3}
                      placeholder="Advance voting days: Friday, April 3; Saturday, April 4; Sunday, April 5 and Monday, April 6, from 9 a.m. to 9 p.m. local time (EDT)"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    />
                  </label>

                  <label className="grid gap-2 text-sm font-medium text-slate-700 xl:col-span-2">
                    Election day hours
                    <textarea
                      value={byElectionForm.electionDayHoursLabel}
                      onChange={(event) => setByElectionForm((current) => ({ ...current, electionDayHoursLabel: event.target.value }))}
                      disabled={!databaseReady || savingByElection}
                      rows={2}
                      placeholder="Election day: Monday, April 13, from 8:30 a.m. to 8:30 p.m. (local time)"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    />
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => void saveByElection()}
                    disabled={!databaseReady || savingByElection || !manualProvinceCode || !byElectionForm.communitySlug || !byElectionForm.title.trim()}
                    className="rounded-full bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingByElection ? 'Saving…' : editingByElectionId ? 'Update by-election' : 'Add by-election'}
                  </button>
                </div>
              </div>

              {activeByElections.length ? (
                <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">EDA</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Election day</th>
                          <th className="px-4 py-3">Source</th>
                          <th className="px-4 py-3">Updated</th>
                          <th className="px-4 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeByElections.map((entry) => (
                          <tr key={entry.id} className="align-top">
                            <td className="px-4 py-3">
                              <div className="font-semibold text-slate-900">{entry.communityName}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                {entry.provinceName}
                                {entry.title ? ` • ${entry.title}` : ''}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                                  entry.status === 'published'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : entry.status === 'completed'
                                      ? 'border-slate-200 bg-slate-100 text-slate-500'
                                      : 'border-amber-200 bg-amber-50 text-amber-700'
                                }`}
                              >
                                {byElectionStatusLabel(entry.status)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{entry.electionDayLabel || 'Not set'}</td>
                            <td className="px-4 py-3">
                              {entry.electionsCanadaUrl ? (
                                <a
                                  href={entry.electionsCanadaUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[var(--cc-primary)] hover:underline"
                                >
                                  Elections Canada
                                </a>
                              ) : (
                                <span className="text-slate-400">Not set</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-slate-500">{new Date(entry.updatedAt).toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => startEditingByElection(entry)}
                                className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  No active by-elections yet. Add one when a federal riding is heading to a vote.
                </div>
              )}
            </>
          ) : null}
        </section>

        {summary ? (
          <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Last Run</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">{summary.sourceKey}</h2>
              <p className="mt-1 text-sm text-slate-600">Imported {new Date(summary.importedAt).toLocaleString()}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Rows processed</p>
                <p className="mt-1">{numberFormatter.format(summary.rowsProcessed)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Parties</p>
                <p className="mt-1">Created {summary.partiesCreated}, updated {summary.partiesUpdated}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Associations</p>
                <p className="mt-1">Created {summary.associationsCreated}, updated {summary.associationsUpdated}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Federal seats</p>
                <p className="mt-1">Created {summary.seatsCreated}, updated {summary.seatsUpdated}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Unresolved rows</p>
                <p className="mt-1">{numberFormatter.format(summary.unresolvedRows)}</p>
              </div>
            </div>

            {summary.unresolvedSample.length ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-semibold">Sample unresolved rows</p>
                <ul className="mt-3 space-y-2">
                  {summary.unresolvedSample.map((item, index) => (
                    <li key={`${item.associationName}-${index}`}>
                      {item.districtName || 'Unknown district'}: {item.associationName || 'Unknown association'} ({item.reason})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {commonsSummary ? (
          <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Commons Sync</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">Provincial federal member fetch</h2>
              <p className="mt-1 text-sm text-slate-600">Imported {new Date(commonsSummary.importedAt).toLocaleString()}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Provinces processed</p>
                <p className="mt-1">{numberFormatter.format(commonsSummary.provincesProcessed)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Members processed</p>
                <p className="mt-1">{numberFormatter.format(commonsSummary.membersProcessed)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Politicians</p>
                <p className="mt-1">Created {commonsSummary.politiciansCreated}, updated {commonsSummary.politiciansUpdated}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Federal seats</p>
                <p className="mt-1">Created {commonsSummary.seatsCreated}, updated {commonsSummary.seatsUpdated}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Scrape jobs</p>
                <p className="mt-1">Created {commonsSummary.scrapeJobsCreated}, requeued {commonsSummary.scrapeJobsRequeued}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Unresolved members</p>
                <p className="mt-1">{numberFormatter.format(commonsSummary.unresolvedMembers)}</p>
              </div>
            </div>

            {commonsSummary.unresolvedSample.length ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-semibold">Sample unresolved members</p>
                <ul className="mt-3 space-y-2">
                  {commonsSummary.unresolvedSample.map((item, index) => (
                    <li key={`${item.personId}-${index}`}>
                      {item.constituencyName || 'Unknown constituency'}: {item.personId} ({item.reason})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {memberDetailSummary ? (
          <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Member Details</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">Queued Commons profile scraping</h2>
              <p className="mt-1 text-sm text-slate-600">Queued {new Date(memberDetailSummary.enqueuedAt).toLocaleString()}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Politicians considered</p>
                <p className="mt-1">{numberFormatter.format(memberDetailSummary.politiciansConsidered)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Jobs</p>
                <p className="mt-1">Created {memberDetailSummary.jobsCreated}, requeued {memberDetailSummary.jobsRequeued}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Already queued</p>
                <p className="mt-1">{numberFormatter.format(memberDetailSummary.jobsAlreadyQueued)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Missing profile URLs</p>
                <p className="mt-1">{numberFormatter.format(memberDetailSummary.skippedMissingProfileUrl)}</p>
              </div>
            </div>
          </section>
        ) : null}

        {ppcCandidateSummary ? (
          <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">PPC Candidates</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">Playwright candidate import</h2>
              <p className="mt-1 text-sm text-slate-600">Imported {new Date(ppcCandidateSummary.importedAt).toLocaleString()}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Cards found</p>
                <p className="mt-1">{numberFormatter.format(ppcCandidateSummary.cardsFound)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Matched ridings</p>
                <p className="mt-1">{numberFormatter.format(ppcCandidateSummary.matchedDistricts)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Politicians</p>
                <p className="mt-1">Created {ppcCandidateSummary.politiciansCreated}, updated {ppcCandidateSummary.politiciansUpdated}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Unmatched cards</p>
                <p className="mt-1">{numberFormatter.format(ppcCandidateSummary.unmatchedCards)}</p>
              </div>
            </div>

            <p className="text-sm text-slate-600">
              Source: <a href={ppcCandidateSummary.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-[var(--cc-primary)] hover:underline">{ppcCandidateSummary.sourceUrl}</a>
            </p>

            {ppcCandidateSummary.unmatchedSample.length ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-semibold">Sample unmatched candidate cards</p>
                <ul className="mt-3 space-y-2">
                  {ppcCandidateSummary.unmatchedSample.map((item, index) => (
                    <li key={`${item.displayName}-${item.ridingName}-${index}`}>
                      {item.displayName} · {item.ridingName}, {item.provinceName} ({item.reason})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {ppcRidingAliases.length ? (
          <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">PPC Aliases</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">Riding alias table</h2>
              <p className="mt-1 text-sm text-slate-600">These overrides are applied during PPC imports and also show when the importer is falling back to shared chamber metadata because the district row is not present in the database yet.</p>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">PPC riding</th>
                    <th className="px-4 py-3">Civil riding</th>
                    <th className="px-4 py-3">Province</th>
                    <th className="px-4 py-3">Community slug</th>
                    <th className="px-4 py-3">District code</th>
                    <th className="px-4 py-3">Database row</th>
                    <th className="px-4 py-3">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ppcRidingAliases.map((alias) => (
                    <tr key={`${alias.provinceCode}-${alias.sourceRidingName}`}>
                      <td className="px-4 py-3 font-medium text-slate-900">{alias.sourceRidingName}</td>
                      <td className="px-4 py-3">{alias.targetRidingName}</td>
                      <td className="px-4 py-3">{alias.provinceName}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{alias.targetCommunitySlug}</td>
                      <td className="px-4 py-3">{alias.targetElectoralDistrictCode ? numberFormatter.format(alias.targetElectoralDistrictCode) : 'Not set'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${alias.databaseBacked ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                          {alias.databaseBacked ? 'Present' : 'Shared fallback'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{alias.note ?? 'None'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </>
    )
  }

  return (
    <AdminWideShell className="bg-slate-50" mainClassName="space-y-6">
      {body()}
    </AdminWideShell>
  )
}
