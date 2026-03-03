'use client'

import ManagedOrganizationsPanel from './ManagedOrganizationsPanel'
import MarketCommunitiesPanel from './MarketCommunitiesPanel'
import YourListingsPanel from './YourListingsPanel'
import YourOrdersPanel from './YourOrdersPanel'

export default function MarketRightRail() {
  return (
    <div className="space-y-6">
      <YourListingsPanel />
      <ManagedOrganizationsPanel />
      <YourOrdersPanel title="Your Orders" limit={8} />
      <MarketCommunitiesPanel />
    </div>
  )
}
