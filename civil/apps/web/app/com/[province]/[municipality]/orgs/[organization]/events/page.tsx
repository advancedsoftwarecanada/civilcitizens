import OrganizationSection from '../../../../../_components/OrganizationSection'

export default function OrganizationEventsPage() {
  return (
    <OrganizationSection title="Events" description="Fundraisers, meetings, and training nights hosted by this org.">
      <p>
        Event publishing will inherit the organization context so admins can schedule members-only or public sessions
        and automatically surface them in the parent community calendar.
      </p>
    </OrganizationSection>
  )
}
