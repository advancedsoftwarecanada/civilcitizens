import ComingSoon from '../_components/ComingSoon'

export default function OrganizationsPage() {
  return (
    <ComingSoon
      activeNavKey="organizations"
      title="Organizations are coming soon"
      message="Organization tools are being refreshed. Check back soon for team management and billing seats."
      secondaryHref="/settings/billing#business-create"
      secondaryLabel="Create organization"
    />
  )
}
