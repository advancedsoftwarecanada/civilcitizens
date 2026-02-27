import OrganizationSection from '../../../../../../_components/OrganizationSection'
import OrganizationChannelsClient from '../../../../../../_components/OrganizationChannelsClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationChatChannelsManagePage({ params }: PageProps) {
  return (
    <OrganizationSection title="Manage channels">
      <OrganizationChannelsClient
        province={params.province}
        municipality={params.municipality}
        slug={params.organization}
        mode="manage"
      />
    </OrganizationSection>
  )
}
