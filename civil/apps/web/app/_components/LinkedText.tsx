import LinkedTextClient from './LinkedTextClient'
import Link from 'next/link'
import { extractLinkedTextSegments } from '../_lib/civilLinks'

export default function LinkedText({
  text,
  className,
  emptyFallback,
  lineClampClassName,
  linkClassName,
}: {
  text: string | null | undefined
  className?: string
  emptyFallback?: string
  lineClampClassName?: string
  linkClassName?: string
}) {
  const value = text?.trim() || ''
  if (!value) {
    return <p className={className}>{emptyFallback ?? ''}</p>
  }

  const segments = extractLinkedTextSegments(value)
  const resolvedLinkClassName = linkClassName || 'font-medium text-emerald-700 hover:text-emerald-800 hover:underline'

  if (segments.some((segment) => segment.kind === 'hashtag')) {
    return <LinkedTextClient segments={segments} className={className} lineClampClassName={lineClampClassName} linkClassName={resolvedLinkClassName} />
  }

  return (
    <p className={[className, lineClampClassName].filter(Boolean).join(' ')}>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          return <span key={`text-${index}`} className="whitespace-pre-wrap">{segment.text}</span>
        }

        if (segment.external) {
          return (
            <a
              key={`link-${segment.kind}-${index}`}
              href={segment.href}
              target="_blank"
              rel="noopener noreferrer"
              className={resolvedLinkClassName}
            >
              {segment.text}
            </a>
          )
        }

        return (
          <Link key={`link-${segment.kind}-${index}`} href={segment.href} className={resolvedLinkClassName}>
            {segment.text}
          </Link>
        )
      })}
    </p>
  )
}