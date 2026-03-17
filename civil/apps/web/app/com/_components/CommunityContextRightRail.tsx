'use client'

import CommunityRightRailClient from '../../_components/CommunityRightRailClient'

export default function CommunityContextRightRail({
  province,
  municipality,
  showCreateOrganization = false,
}: {
  province: string
  municipality: string
  showCreateOrganization?: boolean
}) {
  return <CommunityRightRailClient province={province} municipality={municipality} showCreateOrganization={showCreateOrganization} />
}
