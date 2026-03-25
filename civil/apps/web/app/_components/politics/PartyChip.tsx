import { resolveJurisdictionLabel, resolvePartyVisual, type PartySummary } from '../../_lib/politics'

type PartyChipProps = {
  party: PartySummary | null | undefined
  jurisdiction?: 'federal' | 'provincial' | 'municipal'
  className?: string
}

export default function PartyChip({ party, jurisdiction = 'federal', className }: PartyChipProps) {
  const presentation = resolvePartyVisual(party)
  if (!presentation) return null

  const jurisdictionLabel = resolveJurisdictionLabel(jurisdiction)
  const classes = ['cc-party-chip', `cc-party-chip--${presentation.variant}`, className].filter(Boolean).join(' ')
  const accessibleLabel = `${presentation.name} (${jurisdictionLabel})`

  return (
    <span className={classes} title={accessibleLabel} aria-label={accessibleLabel}>
      <span className="cc-party-chip__mark" aria-hidden="true">
        {presentation.icon}
      </span>
      <span className="cc-party-chip__label">{presentation.code}</span>
      <span className="cc-party-chip__jurisdiction">({jurisdictionLabel})</span>
    </span>
  )
}
