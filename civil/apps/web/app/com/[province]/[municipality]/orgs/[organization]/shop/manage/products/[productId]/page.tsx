import OrganizationSection from '../../../../../../../../_components/OrganizationSection'
import OrganizationShopClient from '../../../../../../../../_components/OrganizationShopClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
    productId: string
  }
}

export default function OrganizationShopManageProductPage({ params }: PageProps) {
  return (
    <OrganizationSection>
      <OrganizationShopClient
        province={params.province}
        municipality={params.municipality}
        slug={params.organization}
        mode="manage"
        manageSection="products"
        focusProductId={params.productId}
      />
    </OrganizationSection>
  )
}
