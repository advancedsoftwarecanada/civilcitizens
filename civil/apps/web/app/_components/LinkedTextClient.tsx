'use client'

import Link from 'next/link'
import HashtagTooltipLink from './HashtagTooltipLink'
import type { LinkedTextSegment } from '../_lib/civilLinks'

export default function LinkedTextClient({
  segments,
  className,
  lineClampClassName,
  linkClassName,
}: {
  segments: LinkedTextSegment[]
  className?: string
  lineClampClassName?: string
  linkClassName: string
}) {
  return (
    <p className={[className, lineClampClassName].filter(Boolean).join(' ')}>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          return <span key={`text-${index}`} className="whitespace-pre-wrap">{segment.text}</span>
        }

        if (segment.kind === 'hashtag' && !segment.external && segment.slug) {
          return (
            <HashtagTooltipLink
              key={`link-${segment.kind}-${index}`}
              slug={segment.slug}
              text={segment.text}
              href={segment.href}
              className={linkClassName}
            />
          )
        }

        if (segment.external) {
          return (
            <a
              key={`link-${segment.kind}-${index}`}
              href={segment.href}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClassName}
            >
              {segment.text}
            </a>
          )
        }

        return (
          <Link key={`link-${segment.kind}-${index}`} href={segment.href} className={linkClassName}>
            {segment.text}
          </Link>
        )
      })}
    </p>
  )
}