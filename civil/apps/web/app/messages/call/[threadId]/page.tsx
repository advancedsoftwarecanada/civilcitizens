import type { Metadata } from 'next'
import MessageCallClient from '../../_components/MessageCallClient'

export const metadata: Metadata = {
  title: 'Call',
}

type MessageCallPageProps = {
  params: {
    threadId: string
  }
}

export default function MessageCallPage({ params }: MessageCallPageProps) {
  return <MessageCallClient threadId={params.threadId} />
}
