"use client"
import { useEffect, useState } from 'react'

type User = { id: string; handle: string; name?: string | null; avatarUrl?: string | null }
type Post = { id: string; body: string; createdAt: string; author: User }

export default function HomePage() {
  const [me, setMe] = useState<User | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { window.location.href = '/login'; return }
    fetch('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject('unauthorized'))
      .then(setMe)
      .catch(() => { localStorage.removeItem('token'); window.location.href = '/login' })
    fetch('/api/posts').then(r => r.json()).then((d) => setPosts(d.items ?? []))
  }, [])

  async function submitPost() {
    const token = localStorage.getItem('token')
    if (!token) { window.location.href = '/login'; return }
    const res = await fetch('/api/posts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ body: draft }) })
    if (res.ok) {
      setDraft('')
      const fresh = await fetch('/api/posts').then(r => r.json())
      setPosts(fresh.items ?? [])
    }
  }

  return (
    <div className="mx-auto max-w-7xl grid grid-cols-12 gap-6 p-4">
      {/* Left nav */}
      <aside className="col-span-3 hidden md:block">
        <div className="sticky top-4 space-y-2">
          <a className="block px-4 py-2 rounded hover:bg-gray-100" href="/home">Home</a>
          <a className="block px-4 py-2 rounded hover:bg-gray-100" href="#">Explore</a>
          <a className="block px-4 py-2 rounded hover:bg-gray-100" href="#">Notifications</a>
          <a className="block px-4 py-2 rounded hover:bg-gray-100" href="#">Profile</a>
          <button className="mt-2 px-4 py-2 bg-black text-white rounded w-full">Post</button>
        </div>
      </aside>

      {/* Center feed */}
      <main className="col-span-12 md:col-span-6 border-x bg-white rounded md:rounded-none">
        <div className="border-b p-4 font-semibold">For you</div>
        <div className="p-4 border-b">
          <textarea className="w-full border rounded p-3" placeholder="What’s happening?" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="text-right mt-2">
            <button className="px-4 py-2 bg-black text-white rounded" onClick={submitPost} disabled={!draft.trim()}>Post</button>
          </div>
        </div>
        {posts.map(p => (
          <article key={p.id} className="p-4 border-b">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-10 h-10 rounded-full bg-gray-200" />
              <div className="font-medium">{p.author?.name || p.author?.handle}</div>
              <div className="text-gray-500 text-sm">{new Date(p.createdAt).toLocaleString()}</div>
            </div>
            <div className="text-[15px] leading-6 whitespace-pre-wrap">{p.body}</div>
            <div className="mt-3 flex gap-6 text-sm text-gray-600">
              <button>Like</button>
              <button>Reply</button>
              <button>Share</button>
            </div>
          </article>
        ))}
      </main>

      {/* Right sidebar */}
      <aside className="col-span-3 hidden lg:block">
        <div className="sticky top-4 space-y-4">
          <div className="bg-white rounded border p-4">
            <div className="font-semibold mb-2">Trends for you</div>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>#Canada</li>
              <li>#AGI</li>
              <li>#Democracy</li>
            </ul>
          </div>
          <div className="bg-white rounded border p-4">
            <div className="font-semibold mb-2">Who to follow</div>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gray-200" />
                <div className="text-sm">@civil</div>
              </div>
              <button className="px-3 py-1 border rounded">Follow</button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
