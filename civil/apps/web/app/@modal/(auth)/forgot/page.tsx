"use client"
import { useRouter } from 'next/navigation'
import Forgot from '../../../forgot/page'
import Modal from '../../../_components/Modal'

export default function ForgotModal() {
  const router = useRouter()
  return (
    <Modal open={true} onClose={() => router.back()} title="Reset your password">
      <Forgot />
    </Modal>
  )
}
