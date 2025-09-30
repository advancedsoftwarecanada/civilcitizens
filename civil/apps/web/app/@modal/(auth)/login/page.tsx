"use client"
import { useRouter } from 'next/navigation'
import Login from '../../../login/page'
import Modal from '../../../_components/Modal'

export default function LoginModal() {
  const router = useRouter()
  return (
    <Modal open={true} onClose={() => router.back()} title="Login">
      <Login />
    </Modal>
  )
}
