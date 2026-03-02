'use client'

import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { useInviteViewStore } from '../../_lib/inviteViewStore'

import type { CommunityOrganization } from '../../_lib/organizations'
import OrganizationRightColumn from './OrganizationRightColumn'

export default function OrganizationLayoutClient({
  children,
  initialOrg,
  province,
  municipality,
}: {
  children: ReactNode
  initialOrg: CommunityOrganization | null
  province: string
  municipality: string
}) {
  const pathname = usePathname()
  const inviteGuestMode = useInviteViewStore((state) => state.inviteGuestMode)

  const isInviteRoute = useMemo(() => {
    if (!pathname) return false
    return pathname.includes('/invite/')
  }, [pathname])

  if (isInviteRoute && inviteGuestMode !== false) {
    return <>{children}</>
  }

  return (
    <div className="mx-auto max-w-screen-2xl overflow-x-hidden px-4 py-5 sm:px-8 sm:py-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-8">
        <div className="min-w-0 space-y-5">{children}</div>
        <aside className="hidden lg:block">
          <OrganizationRightColumn initialOrg={initialOrg} province={province} municipality={municipality} />
        </aside>
      </div>
    </div>
  )
}
