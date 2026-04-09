import OrganizationSection from '../../../../../../_components/OrganizationSection'
import OrganizationShopClient from '../../../../../../_components/OrganizationShopClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
    product: string
  }
}

export default function OrganizationShopProductPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Shop">
      <OrganizationShopClient
        province={params.province}
        municipality={params.municipality}
        slug={params.organization}
        mode="storefront"
        focusProductSlug={params.product}
      />
    </OrganizationSection>
  )
}