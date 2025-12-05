import type { ReactNode } from 'react'
import { OrganizationContextProvider } from '../../../../_components/OrganizationContext'
import OrganizationNav from '../../../../_components/OrganizationNav'

const titleCase = (value: string) =>
  value
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')

type LayoutProps = {
  children: ReactNode
  params: {
    organization: string
  }
}

export default function OrganizationLayout({ children, params }: LayoutProps) {
  const slug = params.organization.trim().toLowerCase()
  const name = titleCase(slug)

  return (
    <OrganizationContextProvider value={{ slug, name }}>
      <OrganizationNav />
      <div className="pb-16">{children}</div>
    </OrganizationContextProvider>
  )
}
