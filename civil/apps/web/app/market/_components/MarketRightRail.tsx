'use client'

import { RightRail } from '../../_components/RightRail'
import YourListingsPanel from './YourListingsPanel'
import YourOrdersPanel from './YourOrdersPanel'

export default function MarketRightRail() {
  return (
    <div className="space-y-6">
      <YourListingsPanel />
      <YourOrdersPanel title="Your Orders" limit={8} />
      <RightRail mode="default" showOrganizations hideContacts />
    </div>
  )
}
