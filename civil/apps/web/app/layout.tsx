import './globals.css'
import { ReactNode } from 'react'
import Toasts from './_components/Toasts'

export default function RootLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen text-gray-900">
        {children}
        {modal}
        <Toasts />
      </body>
    </html>
  )
}
