import { redirect } from 'next/navigation'

export default function CommunityIndexPage({ params }: { params: { province: string; municipality: string } }) {
  redirect(`/com/${encodeURIComponent(params.province)}/${encodeURIComponent(params.municipality)}/posts`)
}
