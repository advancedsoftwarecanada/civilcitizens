import type { Metadata } from 'next'
import type { SearchType } from '../_components/search/searchTypes'
import SearchPageClient from './SearchPageClient'

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
  const initialType: SearchType =
    rawType === 'people' ||
    rawType === 'communities' ||
    rawType === 'organizations' ||
    rawType === 'events' ||
    rawType === 'lives' ||
    rawType === 'market' ||
    rawType === 'posts' ||
    rawType === 'videos'
      ? rawType
      : 'all'
  return <SearchPageClient initialQuery={initialQuery} initialType={initialType} />
}
