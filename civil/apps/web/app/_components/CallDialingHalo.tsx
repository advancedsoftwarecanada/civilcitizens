'use client'

import clsx from 'clsx'

export default function CallDialingHalo({ className }: { className?: string }) {
  return (
    <>
      <div className={clsx('pointer-events-none absolute -inset-7 rounded-full', className)} aria-hidden="true">
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(125,211,252,0.18)_0%,rgba(96,165,250,0.1)_42%,rgba(15,23,42,0)_72%)] blur-md" />
        <div className="cc-call-dial-ring cc-call-dial-ring--middle absolute inset-[10%] rounded-full border border-cyan-200/35" />
        <div className="cc-call-dial-ring cc-call-dial-ring--inner absolute inset-[20%] rounded-full border border-blue-100/30" />
      </div>
      <style jsx>{`
        .cc-call-dial-ring {
          box-shadow:
            0 0 0 1px rgba(148, 163, 184, 0.08),
            0 0 24px rgba(56, 189, 248, 0.18),
            inset 0 0 22px rgba(255, 255, 255, 0.08);
        }

        .cc-call-dial-ring::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: inherit;
          background: conic-gradient(
            from 0deg,
            rgba(125, 211, 252, 0) 0deg,
            rgba(125, 211, 252, 0.9) 48deg,
            rgba(255, 255, 255, 0.2) 84deg,
            rgba(59, 130, 246, 0) 128deg,
            rgba(59, 130, 246, 0) 360deg
          );
          -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px));
          mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px));
          animation: cc-call-dial-spin 3.1s linear infinite;
        }

        .cc-call-dial-ring--middle::before {
          animation-duration: 2.35s;
          animation-direction: reverse;
          opacity: 0.9;
        }

        .cc-call-dial-ring--inner::before {
          animation-duration: 1.75s;
          opacity: 0.8;
        }

        @keyframes cc-call-dial-spin {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </>
  )
}