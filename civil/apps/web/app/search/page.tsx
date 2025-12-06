import type { Metadata } from 'next'
import SearchPageClient, { type SearchType } from './SearchPageClient'

export const metadata: Metadata = {
  title: 'Search',
}

type SearchPageProps = {
  searchParams?: { q?: string | string[]; type?: string | string[] }
}

export default function SearchPage({ searchParams }: SearchPageProps) {
  const rawQuery = searchParams?.q
  const initialQuery = typeof rawQuery === 'string' ? rawQuery : Array.isArray(rawQuery) ? rawQuery[0] ?? '' : ''
  const rawType = searchParams?.type
  const initialType: SearchType = rawType === 'communities' ? 'communities' : 'people'
  return <SearchPageClient initialQuery={initialQuery} initialType={initialType} />
}
