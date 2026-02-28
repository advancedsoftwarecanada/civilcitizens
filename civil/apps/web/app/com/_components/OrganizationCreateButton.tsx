'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildApiUrl } from '../../_lib/api'
import { pushToast } from '../../_components/useToasts'

type Props = {
  province: string
  municipality: string
  defaultOpen?: boolean
}

type CreateOrgResponse = {
  org?: {
    slug: string
    provinceCode?: string | null
    communitySlug?: string | null
  }
  error?: unknown
}

type OrgTypeKey =
  | 'LOCAL_BUSINESS'
  | 'NON_PROFIT'
  | 'COMMUNITY_GROUP'
  | 'EDUCATIONAL'
  | 'RELIGIOUS'
  | 'GOVERNMENT'
  | 'ARTS_CULTURE'
  | 'SPORTS_RECREATION'

const ORG_TYPES: Array<{
  value: OrgTypeKey
  label: string
  blurb: string
  examples: string
}> = [
  {
    value: 'LOCAL_BUSINESS',
    label: 'Local Business',
    blurb: 'For-profit organizations operating in the community.',
    examples: 'Restaurants, trades (plumber/electrician), retail stores, service providers, local manufacturers',
  },
  {
    value: 'NON_PROFIT',
    label: 'Non-Profit / Charity',
    blurb: 'Mission-driven organizations serving the community.',
    examples: 'Food banks, community support groups, fundraisers, advocacy orgs (non-political)',
  },
  {
    value: 'COMMUNITY_GROUP',
    label: 'Community Group',
    blurb: 'Grassroots, informal, or volunteer-led groups.',
    examples: 'Neighbourhood associations, parent groups, hobby clubs, sports leagues, cultural groups',
  },
  {
    value: 'EDUCATIONAL',
    label: 'Educational Organization',
    blurb: 'Learning-focused entities and programs.',
    examples: 'Tutoring centres, music schools, martial arts dojos, training programs, workshops',
  },
  {
    value: 'RELIGIOUS',
    label: 'Religious / Spiritual Organization',
    blurb: 'Faith-based community institutions.',
    examples: 'Churches, mosques, synagogues, temples, spiritual centers',
  },
  {
    value: 'GOVERNMENT',
    label: 'Government / Civic Body',
    blurb: 'Official or semi-official civic entities.',
    examples: 'Municipal departments, town councils, public libraries, community centres, local boards',
  },
  {
    value: 'ARTS_CULTURE',
    label: 'Arts & Culture Organization',
    blurb: 'Creative and cultural contributors.',
    examples: 'Theatres, galleries, music collectives, festivals, film groups',
  },
  {
    value: 'SPORTS_RECREATION',
    label: 'Sports & Recreation Organization',
    blurb: 'Physical activity and recreation groups.',
    examples: 'Hockey leagues, gyms, yoga studios, climbing gyms, martial arts clubs',
  },
]

export default function OrganizationCreateButton({ province, municipality, defaultOpen }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(Boolean(defaultOpen))
  const [pending, setPending] = useState(false)
  const [name, setName] = useState('')
  const [orgType, setOrgType] = useState<OrgTypeKey>('LOCAL_BUSINESS')
  const [description, setDescription] = useState('')

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('token')
  }, [])

  const endpoint = useMemo(() => {
    return buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs`)
  }, [province, municipality])

  const reset = () => {
    setName('')
    setOrgType('LOCAL_BUSINESS')
    setDescription('')
  }

  const activeType = useMemo(() => {
    return ORG_TYPES.find((t) => t.value === orgType) ?? ORG_TYPES[0]!
  }, [orgType])

  const submit = useCallback(async () => {
    if (!token) {
      pushToast('Please sign in to create an organization.', 'error')
      return
    }

    const trimmedName = name.trim()
    if (!trimmedName) {
      pushToast('Organization name is required.', 'error')
      return
    }

    setPending(true)
    try {
      const body: Record<string, unknown> = {
        name: trimmedName,
        type: orgType,
      }
      const trimmedDescription = description.trim()
      if (trimmedDescription) body.description = trimmedDescription

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })

      if (res.status === 401 || res.status === 403) {
        pushToast('Please sign in again.', 'error')
        return
      }

      const payload = (await res.json().catch(() => null)) as CreateOrgResponse | null
      if (!res.ok || !payload?.org?.slug) {
        pushToast('Unable to create organization. Please try again.', 'error')
        return
      }

      const orgSlug = payload.org.slug
      const provinceCode = payload.org.provinceCode ?? province
      const communitySlug = payload.org.communitySlug ?? municipality
      pushToast('Organization created.', 'success')
      reset()
      setOpen(false)
      router.push(`/com/${encodeURIComponent(provinceCode)}/${encodeURIComponent(communitySlug)}/orgs/${encodeURIComponent(orgSlug)}`)
    } catch (err) {
      console.error('Unable to create organization', err)
      pushToast('Unable to create organization. Please try again.', 'error')
    } finally {
      setPending(false)
    }
  }, [description, endpoint, municipality, name, orgType, province, router, token])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300"
      >
        Create an organization
      </button>
    )
  }

  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Create an organization</p>
          <p className="mt-1 text-xs text-slate-500">Organizations are tied to this community.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            reset()
          }}
          className="text-xs font-semibold text-slate-500 hover:text-slate-700"
        >
          Cancel
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            placeholder="Maple Community Association"
            disabled={pending}
          />
        </label>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Type
          <select
            value={orgType}
            onChange={(e) => setOrgType(e.target.value as OrgTypeKey)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            disabled={pending}
          >
            {ORG_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold text-slate-700">{activeType.label}</p>
          <p className="mt-1 text-xs text-slate-600">{activeType.blurb}</p>
          <p className="mt-1 text-xs text-slate-500">Examples: {activeType.examples}</p>
        </div>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Description (optional)
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            rows={3}
            placeholder="What do you do?"
            disabled={pending}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={submit}
            disabled={pending || !name.trim()}
            className="inline-flex items-center justify-center rounded-full border border-[var(--cc-primary)] bg-white px-4 py-2 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)]/10 disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Create'}
          </button>
          <span className="text-xs text-slate-500">Available to all members.</span>
        </div>
      </div>
    </div>
  )
}
