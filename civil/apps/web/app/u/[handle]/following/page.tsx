import UserRelationshipListPage from '../_components/UserRelationshipListPage'

type PageProps = {
  params: {
    handle: string
  }
}

export default function FollowingPage({ params }: PageProps) {
  return <UserRelationshipListPage handle={params.handle} kind="following" title="Following" />
}
