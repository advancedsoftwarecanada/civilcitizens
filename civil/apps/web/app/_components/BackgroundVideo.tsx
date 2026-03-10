type BackgroundVideoProps = {
  className?: string
  videoClassName?: string
  fixed?: boolean
}

const combineClasses = (...values: Array<string | undefined>) => values.filter(Boolean).join(' ')

export default function BackgroundVideo({ className, videoClassName, fixed = false }: BackgroundVideoProps) {
  const baseWrapperClass = fixed ? 'fixed inset-0 -z-20 overflow-hidden pointer-events-none' : 'absolute inset-0 -z-20 overflow-hidden pointer-events-none'
  return (
    <div className={combineClasses(baseWrapperClass, className)} aria-hidden="true">
      <video
        className={combineClasses('h-full w-full object-cover', videoClassName)}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
      >
        <source src="/canada-movie-bg.mp4" type="video/mp4" />
      </video>
    </div>
  )
}
