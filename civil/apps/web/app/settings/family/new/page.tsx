'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { HiOutlineArrowPath } from 'react-icons/hi2'
import DashboardShell from '../../../_components/DashboardShell'
import { RightRail } from '../../../_components/RightRail'
import { pushToast } from '../../../_components/useToasts'
import { buildApiUrl } from '../../../_lib/api'
import { redirectToAuthModal } from '../../../_lib/authModal'

function getStoredToken() {
  if (typeof window === 'undefined') return null
  const token = window.localStorage.getItem('token')
  return token && token.trim() ? token.trim() : null
}

export default function FamilyNewDraftPage() {
  const router = useRouter()

  useEffect(() => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    router.replace('/settings/family/edit')
  }, [router])

  return (
    <DashboardShell rightRail={<RightRail />}>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <HiOutlineArrowPath className="h-5 w-5 animate-spin" />
          Preparing family member editor…
        </div>
      </section>
    </DashboardShell>
  )
}