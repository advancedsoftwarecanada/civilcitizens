import OrganizationSection from '../../../../../../_components/OrganizationSection'
import OrganizationShopControlPanelClient from '../../../../../../_components/OrganizationShopControlPanelClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationShopManagePage({ params }: PageProps) {
  return (
    <OrganizationSection title="Control Panel" description="Manage products, catalogs, orders, and payouts from one place.">
      <OrganizationShopControlPanelClient province={params.province} municipality={params.municipality} organization={params.organization} />
    </OrganizationSection>
  )
}
