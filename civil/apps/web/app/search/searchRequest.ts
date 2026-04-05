import type { SearchType } from '../_components/search/searchTypes'

export const PAGE_LIMIT = 25
export const ALL_SECTION_LIMIT = 8

export function buildSearchRequestParams(query: string, searchType: SearchType) {
  const params = new URLSearchParams({ q: query })

  if (searchType === 'all') {
    params.set('type', 'all')
    params.set('peopleLimit', String(ALL_SECTION_LIMIT))
    params.set('communityLimit', String(ALL_SECTION_LIMIT))
    params.set('organizationLimit', String(ALL_SECTION_LIMIT))
    params.set('eventLimit', String(ALL_SECTION_LIMIT))
    params.set('liveLimit', String(ALL_SECTION_LIMIT))
    params.set('marketLimit', String(ALL_SECTION_LIMIT))
    params.set('postLimit', String(ALL_SECTION_LIMIT))
    params.set('videoLimit', String(ALL_SECTION_LIMIT))
    return params
  }

  params.set('type', searchType)
  params.set('limit', String(PAGE_LIMIT))
  return params
}
