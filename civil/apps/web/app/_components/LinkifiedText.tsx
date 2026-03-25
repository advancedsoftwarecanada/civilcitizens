'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { extractLinkedTextSegments } from '../_lib/civilLinks'

type LinkifiedTextProps = {
  text: string
  className?: string
  mentions?: Array<{
    handle: string
    matchedHandle?: string | null
  }>
}

export default function LinkifiedText({ text, className, mentions }: LinkifiedTextProps) {
  const parts = extractLinkedTextSegments(text, { mentions })

  return (
    <div className={className ? className : 'whitespace-pre-wrap break-words'}>
      {parts.map((part, index) => (
        <Fragment key={`${part.kind}-${index}`}>
          {part.kind === 'text' ? (
            part.text
          ) : part.external ? (
            <a
              href={part.href}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-[var(--cc-primary)] underline decoration-[rgba(213,43,30,0.35)] underline-offset-2 transition hover:text-[var(--cc-primary-700)]"
            >
              {part.text}
            </a>
          ) : (
            <Link
              href={part.href}
              className="break-all text-[var(--cc-primary)] underline decoration-[rgba(213,43,30,0.35)] underline-offset-2 transition hover:text-[var(--cc-primary-700)]"
            >
              {part.text}
            </Link>
          )}
        </Fragment>
      ))}
    </div>
  )
}
