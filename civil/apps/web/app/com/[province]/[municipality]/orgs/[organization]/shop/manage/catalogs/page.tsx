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

export default function OrganizationShopManageCatalogsPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Catalogs">
      <OrganizationShopClient
        province={params.province}
        municipality={params.municipality}
        slug={params.organization}
        mode="manage"
        manageSection="catalogs"
      />
    </OrganizationSection>
  )
}
