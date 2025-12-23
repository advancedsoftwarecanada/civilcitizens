import OrganizationSection from '../../../../../_components/OrganizationSection'

export default function OrganizationJobsPage() {
  return (
    <OrganizationSection title="Jobs" description="Permanent and contract roles managed by this organization.">
      <p>
        Listings created here will automatically inherit the municipality slug for compliance and will feed into the
        main jobs tab. The UI stub keeps the navigation working while we finalize onboarding for hiring teams.
      </p>
    </OrganizationSection>
  )
}
