import UserRelationshipListPage from '../_components/UserRelationshipListPage'

type PageProps = {
  params: {
    handle: string
  }
}

export default function ConnectionsPage({ params }: PageProps) {
  return <UserRelationshipListPage handle={params.handle} kind="connections" title="Business Connections" />
}
