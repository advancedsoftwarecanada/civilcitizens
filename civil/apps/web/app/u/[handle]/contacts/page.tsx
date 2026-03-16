import UserRelationshipListPage from '../_components/UserRelationshipListPage'

type PageProps = {
  params: {
    handle: string
  }
}

export default function ContactsPage({ params }: PageProps) {
  return <UserRelationshipListPage handle={params.handle} kind="contacts" title="Contacts" />
}