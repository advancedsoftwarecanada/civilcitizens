'use client'

import { Fragment } from 'react'
import { normalizeHttpUrl } from '../_lib/civilLinks'

const HTTP_URL_REGEX = /https?:\/\/[^\s<>"']+/gi

type LinkifiedTextProps = {
  text: string
  className?: string
}

export default function LinkifiedText({ text, className }: LinkifiedTextProps) {
  const parts: Array<JSX.Element | string> = []
  let lastIndex = 0

  for (const match of text.matchAll(HTTP_URL_REGEX)) {
    const rawMatch = match[0]
    const index = match.index ?? -1
    if (index < 0) continue

    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index))
    }

    const href = normalizeHttpUrl(rawMatch)
    if (href) {
      parts.push(
        <a
          key={`${href}-${index}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-[var(--cc-primary)] underline decoration-[rgba(213,43,30,0.35)] underline-offset-2 transition hover:text-[var(--cc-primary-700)]"
        >
          {rawMatch}
        </a>,
      )
    } else {
      parts.push(rawMatch)
    }

    lastIndex = index + rawMatch.length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return (
    <div className={className ? className : 'whitespace-pre-wrap break-words'}>
      {parts.map((part, index) => (
        <Fragment key={typeof part === 'string' ? `text-${index}` : index}>{part}</Fragment>
      ))}
    </div>
  )
}
