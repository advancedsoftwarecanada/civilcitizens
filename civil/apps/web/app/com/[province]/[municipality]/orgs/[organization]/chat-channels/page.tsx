import OrganizationSection from '../../../../../_components/OrganizationSection'
import OrganizationChannelsClient from '../../../../../_components/OrganizationChannelsClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
  searchParams?: {
    channel?: string | string[]
  }
}

export default function OrganizationChatChannelsPage({ params, searchParams }: PageProps) {
  const rawChannel = searchParams?.channel
  const initialChannelId = typeof rawChannel === 'string' ? rawChannel : undefined

  return (
    <OrganizationSection title="Chat Channels">
      <OrganizationChannelsClient
        province={params.province}
        municipality={params.municipality}
        slug={params.organization}
        initialChannelId={initialChannelId}
      />
    </OrganizationSection>
  )
}
