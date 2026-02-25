import UserRelationshipListPage from '../_components/UserRelationshipListPage'

type PageProps = {
  params: {
    handle: string
  }
}

export default function FollowersPage({ params }: PageProps) {
  return <UserRelationshipListPage handle={params.handle} kind="followers" title="Followers" />
}
