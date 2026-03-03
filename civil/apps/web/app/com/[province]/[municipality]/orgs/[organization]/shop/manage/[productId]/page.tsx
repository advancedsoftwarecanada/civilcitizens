import { redirect } from 'next/navigation'

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
  redirect(
    `/com/${encodeURIComponent(params.province)}/${encodeURIComponent(params.municipality)}/orgs/${encodeURIComponent(params.organization)}/shop/manage/products/${encodeURIComponent(params.productId)}`,
  )
}
