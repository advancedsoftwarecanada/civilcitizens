'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type RichTextEditorProps = {
  value: string
  onChange: (content: string) => void
  placeholder?: string
  minHeight?: number
  disabled?: boolean
}

type JQueryWithSummernote = {
  summernote: (...args: any[]) => any
  on: (event: string, handler: (...args: any[]) => void) => JQueryWithSummernote
  off: (event: string, handler?: (...args: any[]) => void) => JQueryWithSummernote
}

type JQueryStaticLike = {
  (element?: Element | Document | string | null): JQueryWithSummernote
  fn?: {
    summernote?: unknown
  }
}

type ToolbarGroup = [string, string[]]

const DEFAULT_TOOLBAR: ToolbarGroup[] = [
  ['style', ['bold', 'italic', 'underline', 'clear']],
  ['para', ['ul', 'ol', 'paragraph']],
  ['insert', ['link']],
]

const CDN_STYLES = [
  {
    id: 'cc-summernote-lite-css',
    href: 'https://cdnjs.cloudflare.com/ajax/libs/summernote/0.8.20/summernote-lite.min.css',
  },
]

const CDN_SCRIPTS: Array<{ id: string; src: string }> = [
  {
    id: 'cc-jquery',
    src: 'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js',
  },
  {
    id: 'cc-summernote-lite-js',
    src: 'https://cdnjs.cloudflare.com/ajax/libs/summernote/0.8.20/summernote-lite.min.js',
  },
]

let dependenciesPromise: Promise<void> | null = null

function loadDependencies() {
  if (dependenciesPromise) {
    return dependenciesPromise
  }

  dependenciesPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined') {
      resolve()
      return
    }

    const doc = window.document

    CDN_STYLES.forEach(({ id, href }) => {
      if (doc.getElementById(id)) return
      const link = doc.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = href
      link.crossOrigin = 'anonymous'
      doc.head.appendChild(link)
    })

    const loadScriptAt = (index: number) => {
      if (index >= CDN_SCRIPTS.length) {
        resolve()
        return
      }

      const entry = CDN_SCRIPTS[index]
      if (!entry) {
        resolve()
        return
      }

      const { id, src } = entry
      if (doc.getElementById(id)) {
        loadScriptAt(index + 1)
        return
      }

      const script = doc.createElement('script')
      script.id = id
      script.src = src
      script.async = false
      script.crossOrigin = 'anonymous'
      script.onload = () => loadScriptAt(index + 1)
      script.onerror = () => {
        dependenciesPromise = null
        reject(new Error(`Failed loading ${src}`))
      }
      doc.head.appendChild(script)
    }

    loadScriptAt(0)
  })

  return dependenciesPromise
}

export default function RichTextEditor({ value, onChange, placeholder, minHeight = 220, disabled }: RichTextEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const settingCode = useRef(false)
  const initialValueRef = useRef(value)
  initialValueRef.current = value
  const initialDisabledRef = useRef(disabled)
  initialDisabledRef.current = disabled

  const toolbar = useMemo<ToolbarGroup[]>(
    () => DEFAULT_TOOLBAR.map(([label, actions]) => [label, [...actions]]),
    [],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return

    let cancelled = false
    setLoadError(null)
    loadDependencies()
      .then(() => {
        if (cancelled) return
        setReady(true)
      })
      .catch((err) => {
        console.error('Failed loading Summernote assets', err)
        if (!cancelled) {
          setLoadError('We were unable to load the rich text editor. Please refresh and try again.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!ready || typeof window === 'undefined' || !containerRef.current) return
    const w = window as typeof window & { $?: JQueryStaticLike; jQuery?: JQueryStaticLike }
    const jQuery = w.$ ?? w.jQuery

    if (!jQuery || !jQuery.fn?.summernote) {
      setLoadError('Summernote not available in this browser session.')
      return
    }

    const $element = jQuery(containerRef.current) as JQueryWithSummernote

    const handleChange = (_we: unknown, contents: string) => {
      if (settingCode.current) return
      onChange(contents)
    }

    $element.summernote({
      placeholder,
      height: minHeight,
      dialogsInBody: true,
      disableDragAndDrop: true,
      // Never allow raw HTML editing. (Rich text only.)
      // Note: codeview is not present in the toolbar, but keep filters enabled as a safeguard.
      codeviewFilter: true,
      codeviewIframeFilter: true,
      toolbar,
    })

    $element.on('summernote.change', handleChange)
    const initialValue = initialValueRef.current
    $element.summernote('code', initialValue || '<p></p>')

    if (initialDisabledRef.current) {
      $element.summernote('disable')
    }

    return () => {
      $element.off('summernote.change', handleChange)
      $element.summernote('destroy')
    }
  }, [ready, placeholder, minHeight, onChange, toolbar])

  useEffect(() => {
    if (!ready || typeof window === 'undefined' || !containerRef.current) return
    const w = window as typeof window & { $?: JQueryStaticLike; jQuery?: JQueryStaticLike }
    const jQuery = w.$ ?? w.jQuery
    if (!jQuery || !jQuery.fn?.summernote) return

    const $element = jQuery(containerRef.current) as JQueryWithSummernote
    const current = $element.summernote('code')
    if (value !== current) {
      settingCode.current = true
      $element.summernote('code', value || '<p></p>')
      settingCode.current = false
    }
  }, [ready, value])

  useEffect(() => {
    if (!ready || typeof window === 'undefined' || !containerRef.current) return
    const w = window as typeof window & { $?: JQueryStaticLike; jQuery?: JQueryStaticLike }
    const jQuery = w.$ ?? w.jQuery
    if (!jQuery || !jQuery.fn?.summernote) return

    const $element = jQuery(containerRef.current) as JQueryWithSummernote
    if (disabled) {
      $element.summernote('disable')
    } else {
      $element.summernote('enable')
    }
  }, [ready, disabled])

  if (loadError) {
    return <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{loadError}</div>
  }

  if (!ready) {
    return <div className="rounded border border-dashed p-4 text-sm text-gray-500">Loading editor…</div>
  }

  return <div ref={containerRef} />
}
