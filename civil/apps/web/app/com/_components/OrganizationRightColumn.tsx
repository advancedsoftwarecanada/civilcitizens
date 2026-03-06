'use client'

import { useMemo } from 'react'
import { usePathname } from 'next/navigation'
import type { CommunityOrganization } from '../../_lib/organizations'
import { useCommunity } from './CommunityContext'
import { useOrganization } from './OrganizationContext'
import { buildCommunityPath } from '../../_lib/communityRoutes'
import OrganizationRailCard from './OrganizationRailCard'

type Props = {
  initialOrg: CommunityOrganization | null
  province: string
  municipality: string
}

export default function OrganizationRightColumn({ initialOrg, province, municipality }: Props) {
  const pathname = usePathname()
  const community = useCommunity()
  const organization = useOrganization()

  const basePath = useMemo(
    () =>
      buildCommunityPath({
        province: community.provinceCode,
        municipality: community.municipalitySlug,
        segment: 'orgs',
        remainder: [organization.slug],
      }),
    [community.municipalitySlug, community.provinceCode, organization.slug],
  )

  return (
    <OrganizationRailCard
      pathname={pathname}
      basePath={basePath}
      province={province}
      municipality={municipality}
      organizationSlug={organization.slug}
      organizationName={organization.name}
      initialOrg={initialOrg}
    />
  )
}
