export type HomeChamberSummary = {
  provinceCode: string
  provinceName: string
  chamberSlug: string
  chamberName: string
}

export type MeResponse = {
  id: string
  email: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  homeChamber?: HomeChamberSummary | null
}

export function hasHomeChamber(me: MeResponse | null | undefined): boolean {
  return Boolean(me?.homeChamber && me.homeChamber.chamberSlug && me.homeChamber.provinceCode)
}
