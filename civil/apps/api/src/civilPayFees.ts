export function computeCivilPayFeeCents(amountCents: number) {
  if (amountCents <= 0) return 0
  if (amountCents <= 10000) return 50
  if (amountCents <= 20000) return 65
  if (amountCents <= 50000) return 85
  if (amountCents <= 100000) return 125
  return 200
}