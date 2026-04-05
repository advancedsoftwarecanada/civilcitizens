import UserLiveRoomClient from '../../../../live/_components/UserLiveRoomClient'

export default async function UserLiveRoomPage({ params }: { params: Promise<{ handle: string; spaceId: string }> }) {
  const resolved = await params
  return <UserLiveRoomClient handle={resolved.handle} spaceId={resolved.spaceId} />
}