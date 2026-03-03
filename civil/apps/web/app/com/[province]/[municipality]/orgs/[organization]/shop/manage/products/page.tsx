import OrganizationSection from '../../../../../../../_components/OrganizationSection'
import OrganizationShopClient from '../../../../../../../_components/OrganizationShopClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationShopManageProductsPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Products">
      <OrganizationShopClient
        province={params.province}
        municipality={params.municipality}
        slug={params.organization}
        mode="manage"
        manageSection="products"
      />
    </OrganizationSection>
  )
}
