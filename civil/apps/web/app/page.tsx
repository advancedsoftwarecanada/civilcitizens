"use client"
import React from 'react'
import { Button } from '@civil/ui'

export default function Home() {
  return (
    <main className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Civil</h1>
      <p>Welcome to the Next.js front-end.</p>
      <Button onClick={() => alert('Hello Civil!')}>Test UI</Button>
    </main>
  )
}
