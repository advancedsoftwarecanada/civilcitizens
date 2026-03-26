import { calculateCivilFeeCents } from '@civil/shared'

export function computeCivilPayFeeCents(amountCents: number) {
  return calculateCivilFeeCents(amountCents)
}