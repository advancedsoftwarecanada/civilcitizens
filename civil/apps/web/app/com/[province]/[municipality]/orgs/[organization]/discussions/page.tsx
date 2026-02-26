import { redirect } from 'next/navigation'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationDiscussionsPage({ params }: PageProps) {
  redirect(
    `/com/${encodeURIComponent(params.province)}/${encodeURIComponent(params.municipality)}/orgs/${encodeURIComponent(params.organization)}/forum`,
  )
}
