import { HiOutlineMinus, HiOutlinePlus } from 'react-icons/hi2'

type MapZoomControlsProps = {
  onZoomIn: () => void
  onZoomOut: () => void
  className?: string
}

export function MapZoomControls({ onZoomIn, onZoomOut, className }: MapZoomControlsProps) {
  const positionClassName = className?.trim() || 'top-4'

  return (
    <div className={`pointer-events-none absolute right-4 ${positionClassName}`}>
      <div className="pointer-events-auto overflow-hidden rounded-2xl border-2 border-black bg-white/92 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={onZoomIn}
          className="flex h-11 w-11 items-center justify-center border-b-2 border-black text-slate-900 transition hover:bg-slate-100"
          aria-label="Zoom in"
        >
          <HiOutlinePlus className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onZoomOut}
          className="flex h-11 w-11 items-center justify-center text-slate-900 transition hover:bg-slate-100"
          aria-label="Zoom out"
        >
          <HiOutlineMinus className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}