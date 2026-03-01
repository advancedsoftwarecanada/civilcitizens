import OrganizationSection from '../../../../../_components/OrganizationSection'
import OrganizationReferralsClient from '../../../../../_components/OrganizationReferralsClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    province: string
    municipality: string
    organization: string
  }
}

export default function OrganizationReferralsPage({ params }: PageProps) {
  return (
    <OrganizationSection title="Referrals" description="Invite people to join your organization and track direct referrals.">
      <OrganizationReferralsClient province={params.province} municipality={params.municipality} slug={params.organization} />
    </OrganizationSection>
  )
}
