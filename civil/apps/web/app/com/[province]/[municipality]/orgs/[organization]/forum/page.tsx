import OrganizationSection from '../../../../../_components/OrganizationSection'
import OrganizationForumClient from '../../../../../_components/OrganizationForumClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationForumPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Forum" description="Compressed post index for quick scanning and search.">
      <OrganizationForumClient province={params.province} municipality={params.municipality} slug={params.organization} />
    </OrganizationSection>
  )
}
