import type { ReactNode } from 'react'
import { OrganizationContextProvider } from '../../../../_components/OrganizationContext'
import OrganizationNav from '../../../../_components/OrganizationNav'
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
  const org = await fetchCommunityOrganization({ province: params.province, municipality: params.municipality, slug })
  const name = org?.name ?? titleCase(slug)

  return (
    <OrganizationContextProvider value={{ slug, name }}>
      <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-8">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-10">
          <div className="space-y-6">
            <div className="lg:hidden">
              <OrganizationNav />
            </div>
            {children}
          </div>
          <aside className="hidden lg:block">
            <div className="space-y-5">
              <OrganizationNav />
              <OrganizationRightColumn initialOrg={org} province={params.province} municipality={params.municipality} />
            </div>
          </aside>
        </div>
      </div>
    </OrganizationContextProvider>
  )
}
