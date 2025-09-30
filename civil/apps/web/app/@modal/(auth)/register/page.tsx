"use client"
import { useRouter } from 'next/navigation'
import Register from '../../../register/page'
import Modal from '../../../_components/Modal'

export default function RegisterModal() {
  const router = useRouter()
  return (
    <Modal open={true} onClose={() => router.back()} title="Create your account">
      <Register />
    </Modal>
  )
}
