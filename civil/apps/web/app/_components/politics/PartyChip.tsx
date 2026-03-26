import Link from 'next/link'
import { resolveJurisdictionLabel, resolvePartyHref, resolvePartyVisual, type PartySummary } from '../../_lib/politics'

type PartyChipProps = {
  party: PartySummary | null | undefined
  jurisdiction?: 'federal' | 'provincial' | 'municipal'
  className?: string
  href?: string | null
  linkable?: boolean
}

export default function PartyChip({
  party,
  jurisdiction = 'federal',
  className,
  href,
  linkable = true,
}: PartyChipProps) {
  const presentation = resolvePartyVisual(party)
  if (!presentation) return null

  const jurisdictionLabel = resolveJurisdictionLabel(jurisdiction)
  const classes = ['cc-party-chip', `cc-party-chip--${presentation.variant}`, className].filter(Boolean).join(' ')
  const accessibleLabel = `${presentation.name} (${jurisdictionLabel})`
  const resolvedHref = linkable ? (href ?? resolvePartyHref(party, jurisdiction)) : null
  const content = (
    <>
      <span className="cc-party-chip__mark" aria-hidden="true">
        {presentation.icon}
      </span>
      <span className="cc-party-chip__label">{presentation.code}</span>
      <span className="cc-party-chip__jurisdiction">({jurisdictionLabel})</span>
    </>
  )

  if (resolvedHref) {
    return (
      <Link href={resolvedHref} className={classes} title={accessibleLabel} aria-label={accessibleLabel}>
        {content}
      </Link>
    )
  }

  return (
    <span className={classes} title={accessibleLabel} aria-label={accessibleLabel}>
      {content}
    </span>
  )
}
