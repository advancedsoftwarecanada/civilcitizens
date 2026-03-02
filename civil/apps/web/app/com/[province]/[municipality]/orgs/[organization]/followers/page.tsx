import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationFollowersPage({ params }: PageProps) {
  redirect(
    `/com/${encodeURIComponent(params.province)}/${encodeURIComponent(params.municipality)}/orgs/${encodeURIComponent(params.organization)}/joins`,
  )
}
