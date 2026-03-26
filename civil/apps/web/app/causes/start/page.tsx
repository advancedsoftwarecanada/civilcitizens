'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { HiOutlineArrowPath } from 'react-icons/hi2'
import DashboardShell from '../../_components/DashboardShell'
import { RightRail } from '../../_components/RightRail'
import { pushToast } from '../../_components/useToasts'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { getStoredToken } from '../../_lib/tokenStorage'

export default function StartCausePage() {
  const router = useRouter()

  useEffect(() => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    let cancelled = false
    const bootstrap = async () => {
      try {
        const response = await fetch(buildApiUrl('/causes/drafts'), {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        })

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (response.status === 409) {
          pushToast('Connect your Civil Wallet payouts before starting a cause.', 'error')
          router.replace('/wallet')
          return
        }

        if (!response.ok) {
          pushToast('Unable to start a new cause right now.', 'error')
          router.replace('/causes')
          return
        }

        const payload = (await response.json().catch(() => null)) as { draft?: { id?: string } } | null
        const draftId = payload?.draft?.id?.trim()
        if (!draftId) {
          pushToast('Unable to open the cause editor right now.', 'error')
          router.replace('/causes')
          return
        }

        if (!cancelled) {
          router.replace(`/causes/drafts/${encodeURIComponent(draftId)}`)
        }
      } catch {
        if (!cancelled) {
          pushToast('Unable to start a new cause right now.', 'error')
          router.replace('/causes')
        }
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <DashboardShell rightRail={<RightRail mode="default" />}>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <HiOutlineArrowPath className="h-5 w-5 animate-spin" />
          Preparing cause draft editor…
        </div>
      </section>
    </DashboardShell>
  )
}