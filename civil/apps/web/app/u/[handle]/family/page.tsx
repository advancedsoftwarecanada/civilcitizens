import UserRelationshipListPage from '../_components/UserRelationshipListPage'

type PageProps = {
  params: {
    handle: string
  }
}

export default function FamilyPage({ params }: PageProps) {
  return <UserRelationshipListPage handle={params.handle} kind="family" title="Family" />
}
