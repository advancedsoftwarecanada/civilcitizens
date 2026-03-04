import { redirect } from 'next/navigation'

export default function MessagesGroupsPage() {
  redirect('/messages?inbox=groups')
}
