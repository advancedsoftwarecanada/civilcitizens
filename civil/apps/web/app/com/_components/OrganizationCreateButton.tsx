'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildApiUrl } from '../../_lib/api'
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
