'use client'

export default function CivilMapLoadingState({
  className = 'h-[460px]',
  label = 'Loading Civil Maps',
}: {
  className?: string
  label?: string
}) {
  return (
    <div className={`relative flex w-full items-center justify-center overflow-hidden rounded-[24px] border border-[var(--cc-border)] bg-slate-100 shadow-subtle ${className}`}>
      <div className="flex flex-col items-center gap-4 text-center">
        <span
          aria-hidden="true"
          className="inline-flex h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[var(--cc-primary)]"
        />
        <p className="text-sm font-medium text-slate-600">{label}</p>
      </div>
    </div>
  )
}
