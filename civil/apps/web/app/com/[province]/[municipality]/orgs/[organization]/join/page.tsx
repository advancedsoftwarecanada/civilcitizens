import OrganizationSection from '../../../../../_components/OrganizationSection'
import OrganizationJoinClient from '../../../../../_components/OrganizationJoinClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
  searchParams?: {
    ref?: string
    inviter?: string
    org?: string
    plan?: string
  }
}

export default function OrganizationJoinPage({ params, searchParams }: PageProps) {
  const inviterName = (searchParams?.inviter || 'A Civil Citizens member').trim()
  const orgName = (searchParams?.org || params.organization.replace(/-/g, ' ')).trim()
  const referrerUserId = searchParams?.ref?.trim() || null
  const planId = searchParams?.plan?.trim() || null

  return (
    <OrganizationSection title="Join Organization" description="You received an invitation to join this organization.">
      <OrganizationJoinClient
        province={params.province}
        municipality={params.municipality}
        slug={params.organization}
        referrerUserId={referrerUserId}
        inviterName={inviterName}
        orgName={orgName}
        planId={planId}
      />
    </OrganizationSection>
  )
}
