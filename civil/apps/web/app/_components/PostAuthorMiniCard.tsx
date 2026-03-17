'use client'

import CivilCard from './CivilCard'
import { formatUserDisplayName } from '../_lib/text'

type PostAuthorMiniCardProps = {
  author: {
    handle: string
    name?: string | null
    avatarUrl?: string | null
    coverUrl?: string | null
    isPremium?: boolean
    isVerified?: boolean
  }
  className?: string
}

export default function PostAuthorMiniCard({ author, className }: PostAuthorMiniCardProps) {
  const displayName = formatUserDisplayName(author.name, author.handle) || author.handle

  return (
    <CivilCard
      size="sm"
      name={displayName}
      subtitle="Written by"
      avatarAlt={displayName}
      avatarInitials={displayName}
      avatarSrc={author.avatarUrl ?? null}
      avatarHref={`/u/${author.handle}`}
      titleHref={`/u/${author.handle}`}
      isVerified={Boolean(author.isVerified)}
      isBusiness={Boolean(author.isPremium)}
      titleLines={2}
      titleClassName="w-full text-center"
      subtitleClassName="text-center"
      className={className}
    />
  )
}