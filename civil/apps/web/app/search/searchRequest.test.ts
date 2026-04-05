import { describe, expect, it } from 'vitest'
import { buildSearchRequestParams } from './searchRequest'

describe('buildSearchRequestParams', () => {
  it('uses the dedicated type endpoint shape for people searches', () => {
    const params = buildSearchRequestParams('ac', 'people')

    expect(params.get('q')).toBe('ac')
    expect(params.get('type')).toBe('people')
    expect(params.get('limit')).toBe('25')
    expect(params.get('peopleLimit')).toBeNull()
  })

  it('uses section limits for all search', () => {
    const params = buildSearchRequestParams('ac', 'all')

    expect(params.get('q')).toBe('ac')
    expect(params.get('type')).toBe('all')
    expect(params.get('peopleLimit')).toBe('8')
    expect(params.get('communityLimit')).toBe('8')
    expect(params.get('organizationLimit')).toBe('8')
    expect(params.get('eventLimit')).toBe('8')
    expect(params.get('liveLimit')).toBe('8')
    expect(params.get('marketLimit')).toBe('8')
    expect(params.get('postLimit')).toBe('8')
    expect(params.get('videoLimit')).toBe('8')
    expect(params.get('limit')).toBeNull()
  })
})
