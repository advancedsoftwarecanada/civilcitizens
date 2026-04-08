'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { pushToast } from '../../_components/useToasts'

type Props = {
  province: string
  municipality: string
}

type CreateOrgResponse = {
  org?: {
    slug: string
    provinceCode?: string | null
    communitySlug?: string | null
  }
  error?: unknown
}

function buildCreateOrganizationErrorMessage(payload: CreateOrgResponse | null, text: string | null) {
  if (typeof payload?.error === 'string') {
    switch (payload.error) {
      case 'business_limit_reached':
        return 'You have reached the organization limit for this account.'
      case 'province_not_found':
      case 'community_not_found':
        return 'That chamber of citizens could not be found. Refresh and try again.'
      case 'user_not_found':
        return 'Your account could not be loaded. Please sign in again.'
      case 'unauthorized':
        return 'Please sign in again.'
      default:
        return payload.error
    }
  }
  return text || 'Unable to create organization. Please try again.'
}

export default function OrganizationCreateButton({ province, municipality }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('token')
  }, [])

  const endpoint = useMemo(() => {
    return buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/draft`)
  }, [province, municipality])

  const submit = useCallback(async () => {
    if (!token) {
      pushToast('Please sign in to create an organization.', 'error')
      return
    }

    setPending(true)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      })

      const { json, text } = await parseApiResponse<CreateOrgResponse>(res)

      if (res.status === 401) {
        pushToast('Please sign in again.', 'error')
        return
      }

      if (!res.ok || !json?.org?.slug) {
        pushToast(buildCreateOrganizationErrorMessage(json, text), 'error')
        return
      }

      const orgSlug = json.org.slug
      const provinceCode = json.org.provinceCode ?? province
      const communitySlug = json.org.communitySlug ?? municipality
      pushToast('Organization draft created.', 'success')
      router.push(`/com/${encodeURIComponent(provinceCode)}/${encodeURIComponent(communitySlug)}/orgs/${encodeURIComponent(orgSlug)}/settings/details`)
    } catch (err) {
      console.error('Unable to create organization', err)
      pushToast('Unable to create organization. Please try again.', 'error')
    } finally {
      setPending(false)
    }
  }, [endpoint, municipality, province, router, token])

  return (
    <button
      type="button"
      onClick={() => {
        void submit()
      }}
      disabled={pending}
      className="flex w-full items-center justify-center rounded-2xl bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Creating draft…' : 'Create an organization'}
    </button>
  )
}
