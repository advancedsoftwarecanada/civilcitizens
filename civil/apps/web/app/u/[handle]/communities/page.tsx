import UserRelationshipListPage from '../_components/UserRelationshipListPage'

type PageProps = {
  params: {
    handle: string
  }
}

export default function CommunitiesPage({ params }: PageProps) {
  return <UserRelationshipListPage handle={params.handle} kind="communities" title="Chambers of Citizens" />
}
