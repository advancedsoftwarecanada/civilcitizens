import type { ReactNode } from 'react'
import { OrganizationContextProvider } from '../../../../_components/OrganizationContext'
import OrganizationRightColumn from '../../../../_components/OrganizationRightColumn'
import { fetchCommunityOrganization } from '../../../../../_lib/organizations'

export const dynamic = 'force-dynamic'

const titleCase = (value: string) =>
  value
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')

type LayoutProps = {
  children: ReactNode
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default async function OrganizationLayout({ children, params }: LayoutProps) {
  const slug = params.organization.trim().toLowerCase()
  const org = await fetchCommunityOrganization({
    province: params.province,
    municipality: params.municipality,
    slug,
  })
  const name = org?.name ?? titleCase(slug)

  return (
    <OrganizationContextProvider value={{ slug, name }}>
      <div className="mx-auto max-w-screen-2xl overflow-x-hidden px-4 py-5 sm:px-8 sm:py-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-8">
          <div className="min-w-0 space-y-5">{children}</div>
          <aside className="hidden lg:block">
            <OrganizationRightColumn initialOrg={org} province={params.province} municipality={params.municipality} />
          </aside>
        </div>
      </div>
    </OrganizationContextProvider>
  )
}
