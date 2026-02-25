import UserRelationshipListPage from '../_components/UserRelationshipListPage'

type PageProps = {
  params: {
    handle: string
  }
}

export default function OrganizationsPage({ params }: PageProps) {
  return <UserRelationshipListPage handle={params.handle} kind="organizations" title="Organizations" />
}
