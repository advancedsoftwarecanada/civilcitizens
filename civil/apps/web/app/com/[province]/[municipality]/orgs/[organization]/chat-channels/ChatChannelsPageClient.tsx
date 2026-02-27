'use client'

import { useState } from 'react'
import OrganizationSection from '../../../../../_components/OrganizationSection'
import OrganizationChannelsClient from '../../../../../_components/OrganizationChannelsClient'

export default function ChatChannelsPageClient({
  province,
  municipality,
  slug,
  initialChannelId,
}: {
  province: string
  municipality: string
  slug: string
  initialChannelId?: string
}) {
  const [title, setTitle] = useState('Select channel')

  return (
    <OrganizationSection title={title}>
      <OrganizationChannelsClient
        province={province}
        municipality={municipality}
        slug={slug}
        initialChannelId={initialChannelId}
        mode="chat"
        onTitleChange={setTitle}
      />
    </OrganizationSection>
  )
}
