type BuildCommunityPathOptions = {
  province: string
  municipality: string
  segment?: string
  remainder?: string[]
}

const encodeSegment = (segment: string) => encodeURIComponent(segment.toLowerCase())

export const buildCommunityPath = ({ province, municipality, segment, remainder }: BuildCommunityPathOptions): string => {
  const base = `/com/${encodeSegment(province)}/${encodeSegment(municipality)}`
  if (!segment) {
    return base
  }
  const rest = remainder?.length ? `/${remainder.map(encodeSegment).join('/')}` : ''
  return `${base}/${encodeSegment(segment)}${rest}`
}
