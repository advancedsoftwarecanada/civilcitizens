import UserRelationshipListPage from '../_components/UserRelationshipListPage'

type PageProps = {
  params: {
    handle: string
  }
}

export default function FriendsPage({ params }: PageProps) {
  return <UserRelationshipListPage handle={params.handle} kind="friends" title="Friends" />
}
