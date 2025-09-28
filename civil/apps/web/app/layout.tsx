import './globals.css'
import { ReactNode } from 'react'

export default function RootLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        {children}
        {modal}
      </body>
    </html>
  )
}
