type PoliticianOffice = {
  label: string | null
  lines: string[]
  telephone: string | null
  fax: string | null
}

type PoliticianContactCardProps = {
  displayName: string
  partyName?: string | null
  officeType?: string | null
  districtName?: string | null
  photoUrl?: string | null
  profileUrl?: string | null
  xmlUrl?: string | null
  email?: string | null
  website?: string | null
  hillOffice?: PoliticianOffice | null
  constituencyOffices?: PoliticianOffice[]
  lastScrapeAt?: string | null
  lastXmlSyncAt?: string | null
  lastHtmlSyncAt?: string | null
}

function buildInitials(displayName: string) {
  const parts = displayName
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 2)
  return parts.map((entry) => entry.charAt(0).toUpperCase()).join('') || 'MP'
}

function formatOfficeTitle(value: string | null | undefined) {
  return value?.trim() || 'Office'
}

function renderPhoneHref(value: string) {
  return `tel:${value.replace(/[^0-9+]/g, '')}`
}

function normalizeOfficeLines(lines: string[]) {
  return lines
    .flatMap((line) => line.split(/\n+/))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !/^Email$/i.test(line) && !/^Website$/i.test(line))
}

function OfficeBlock({ office }: { office: PoliticianOffice }) {
  const normalizedLines = normalizeOfficeLines(office.lines)

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-semibold text-slate-900">{formatOfficeTitle(office.label)}</p>
      {normalizedLines.length ? (
        <div className="mt-2 space-y-1 text-sm text-slate-600">
          {normalizedLines.map((line, index) => (
            <p key={`${line}-${index}`}>{line}</p>
          ))}
        </div>
      ) : null}
      {office.telephone ? (
        <p className="mt-3 text-sm text-slate-700">
          <span className="font-semibold text-slate-900">Phone:</span>{' '}
          <a href={renderPhoneHref(office.telephone)} className="text-[var(--cc-primary)] hover:underline">
            {office.telephone}
          </a>
        </p>
      ) : null}
      {office.fax ? (
        <p className="mt-1 text-sm text-slate-700">
          <span className="font-semibold text-slate-900">Fax:</span> {office.fax}
        </p>
      ) : null}
    </div>
  )
}

export default function PoliticianContactCard({
  displayName,
  partyName,
  officeType,
  districtName,
  photoUrl,
  profileUrl,
  xmlUrl,
  email,
  website,
  hillOffice,
  constituencyOffices = [],
  lastScrapeAt,
  lastXmlSyncAt,
  lastHtmlSyncAt,
}: PoliticianContactCardProps) {
  const hasContactDetails = Boolean(email || website || hillOffice || constituencyOffices.length)

  return (
    <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-subtle">
      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <div className="relative h-28 w-28 overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-100">
          {photoUrl ? (
            <img src={photoUrl} alt={displayName} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-slate-500">{buildInitials(displayName)}</div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">House of Commons</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">{displayName}</h3>
            <p className="mt-1 text-sm text-slate-600">
              {[partyName, officeType, districtName].filter(Boolean).join(' · ') || 'Federal member profile'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-sm">
            {profileUrl ? (
              <a
                href={profileUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-full border border-[var(--cc-primary)]/20 bg-[var(--cc-primary)]/5 px-3 py-1.5 font-semibold text-[var(--cc-primary)] hover:border-[var(--cc-primary)]/35"
              >
                Commons profile
              </a>
            ) : null}
            {website ? (
              <a
                href={website}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:border-slate-300"
              >
                Website
              </a>
            ) : null}
            {email ? (
              <a href={`mailto:${email}`} className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:border-slate-300">
                Email
              </a>
            ) : null}
            {xmlUrl ? (
              <a
                href={xmlUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:border-slate-300"
              >
                XML source
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">Direct contact</p>
          {hasContactDetails ? (
            <div className="mt-3 space-y-2 text-sm text-slate-700">
              {email ? (
                <p>
                  <span className="font-semibold text-slate-900">Email:</span>{' '}
                  <a href={`mailto:${email}`} className="text-[var(--cc-primary)] hover:underline">
                    {email}
                  </a>
                </p>
              ) : null}
              {website ? (
                <p>
                  <span className="font-semibold text-slate-900">Website:</span>{' '}
                  <a href={website} target="_blank" rel="noreferrer" className="text-[var(--cc-primary)] hover:underline">
                    {website}
                  </a>
                </p>
              ) : null}
              {!email && !website && !hillOffice && !constituencyOffices.length ? <p className="text-slate-500">Contact details have not been scraped yet.</p> : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Contact details have not been scraped yet.</p>
          )}
        </div>

        {hillOffice ? <OfficeBlock office={hillOffice} /> : <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Hill office details have not been scraped yet.</div>}
      </div>

      {constituencyOffices.length ? (
        <div className="mt-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Constituency Offices</p>
          <div className="grid gap-3 lg:grid-cols-2">
            {constituencyOffices.map((office, index) => (
              <OfficeBlock key={`${office.label ?? 'constituency'}-${index}`} office={office} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}