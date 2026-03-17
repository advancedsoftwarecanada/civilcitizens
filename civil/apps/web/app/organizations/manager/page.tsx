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
        emptyMessage="Follow a community first to create organizations."
        errorMessage="Unable to load organizations right now."
      >
        {selectedCommunity ? (
          <div className="space-y-3">
            <OrganizationCreateButton
              province={selectedCommunity.provinceCode.toLowerCase()}
              municipality={selectedCommunity.communitySlug.toLowerCase()}
            />
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              New organizations now open as drafts in settings, where you can set the name, URL, type, and visibility before publishing.
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
