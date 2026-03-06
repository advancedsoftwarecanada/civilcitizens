'use client'

import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { usePathname } from 'next/navigation'
import DashboardShell from '../../_components/DashboardShell'
import type { CommunitySummary } from '../../_lib/community'
import CommunityContextRightRail from './CommunityContextRightRail'
import { CommunityContextProvider } from './CommunityContext'
import CommunityHeader from './CommunityHeader'
import { useInviteViewStore } from '../../_lib/inviteViewStore'
import { isMeetingRoomPath } from '../../_lib/meetingRoomRoute'

export default function CommunityLayoutClient({
  summary,
  province,
  municipality,
  children,
}: {
  summary: CommunitySummary
  province: string
  municipality: string
  children: ReactNode
}) {
  const pathname = usePathname()
  const inviteGuestMode = useInviteViewStore((state) => state.inviteGuestMode)

  const isOrganizationDetailRoute = useMemo(() => {
    if (!pathname) return false
    return /^\/com\/[^/]+\/[^/]+\/orgs\/[^/]+(\/.*)?$/.test(pathname)
  }, [pathname])

  const isInviteRoute = useMemo(() => {
    if (!pathname) return false
    return pathname.includes('/invite/')
  }, [pathname])
  const isMeetingRoomRoute = useMemo(() => isMeetingRoomPath(pathname), [pathname])

  if (isInviteRoute && inviteGuestMode !== false) {
    return <>{children}</>
  }

  if (isMeetingRoomRoute) {
    return <CommunityContextProvider value={summary}>{children}</CommunityContextProvider>
  }

  return (
    <CommunityContextProvider value={summary}>
      <DashboardShell
        rightRail={
          isOrganizationDetailRoute ? null : <CommunityContextRightRail province={province} municipality={municipality} />
        }
        className="bg-slate-50"
        containerClassName="px-0 sm:px-0"
        mainClassName="pt-0"
      >
        <div className="min-h-screen bg-slate-50">
          <CommunityHeader summary={summary} />
          <div className="pb-16">{children}</div>
        </div>
      </DashboardShell>
    </CommunityContextProvider>
  )
}
