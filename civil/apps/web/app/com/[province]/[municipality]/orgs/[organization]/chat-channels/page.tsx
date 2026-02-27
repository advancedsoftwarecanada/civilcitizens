import ChatChannelsPageClient from './ChatChannelsPageClient'

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
    <ChatChannelsPageClient
      province={params.province}
      municipality={params.municipality}
      slug={params.organization}
      initialChannelId={initialChannelId}
    />
  )
}
