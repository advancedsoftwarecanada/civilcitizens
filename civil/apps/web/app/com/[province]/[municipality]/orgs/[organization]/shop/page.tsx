import OrganizationSection from '../../../../../_components/OrganizationSection'
import OrganizationShopClient from '../../../../../_components/OrganizationShopClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
  searchParams?: {
    product?: string
  }
}

export default function OrganizationShopPage({ params, searchParams }: PageProps) {
  const focusProductId = typeof searchParams?.product === 'string' && searchParams.product.trim() ? searchParams.product.trim() : undefined

  return (
    <OrganizationSection title="Shop">
      <OrganizationShopClient
        province={params.province}
        municipality={params.municipality}
        slug={params.organization}
        mode="storefront"
        focusProductId={focusProductId}
      />
    </OrganizationSection>
  )
}
