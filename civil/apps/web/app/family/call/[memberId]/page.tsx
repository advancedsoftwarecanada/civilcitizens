import type { Metadata } from 'next'
import FamilyCallClient from '../../_components/FamilyCallClient'

export const metadata: Metadata = {
  title: 'Family Call',
}

type FamilyCallPageProps = {
  params: {
    memberId: string
  }
}

export default function FamilyCallPage({ params }: FamilyCallPageProps) {
  return <FamilyCallClient memberId={params.memberId} />
}