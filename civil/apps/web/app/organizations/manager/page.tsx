'use client'

import DashboardShell from '../../_components/DashboardShell'
import { RightRail } from '../../_components/RightRail'
import OrganizationCreateButton from '../../com/_components/OrganizationCreateButton'
import OrganizationsAdminCreatePanel from '../_components/OrganizationsAdminCreatePanel'
import OrganizationManagerListCard from '../_components/OrganizationManagerListCard'
import { useOrganizationsManagerData } from '../_hooks/useOrganizationsManagerData'

export default function OrganizationsManagerPage() {
  const {
    status,
    followedOrganizations,
    ownedOrganizations,
    communityOptions,
    selectedCommunity,
    selectedCommunityKey,
    setSelectedCommunityKey,
  } = useOrganizationsManagerData()

  return (
    <DashboardShell
      rightRail={<RightRail mode="organizations" />}
      className="bg-slate-50"
      mainClassName="space-y-6"
    >
      <OrganizationsAdminCreatePanel
        title="Organization manager"
        description="Manage the organizations you follow and the organizations you own."
        status={status}
        options={communityOptions}
        selectedKey={selectedCommunityKey}
        onSelectedKeyChange={setSelectedCommunityKey}
        emptyMessage="Follow a chamber of citizens first to create organizations."
        errorMessage="Unable to load organizations right now."
      >
        {selectedCommunity ? (
          <OrganizationCreateButton
            province={selectedCommunity.provinceCode.toLowerCase()}
            municipality={selectedCommunity.communitySlug.toLowerCase()}
          />
        ) : null}

        <div className="space-y-4">
          <OrganizationManagerListCard
            title="Organizations I follow"
            emptyMessage="No organizations followed."
            items={followedOrganizations}
          />

          <OrganizationManagerListCard
            title="Organizations I own"
            emptyMessage="No owned organizations yet."
            items={ownedOrganizations}
          />
        </div>
      </OrganizationsAdminCreatePanel>
    </DashboardShell>
  )
}
