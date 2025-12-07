import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import AutoRedirect from './_components/AutoRedirect'
import BackgroundVideo from './_components/BackgroundVideo'
import {
  FaUsers,
  FaHandshake,
  FaStore,
  FaBriefcase,
  FaComments,
  FaWallet,
  FaBuilding,
  FaGlobeAmericas,
} from 'react-icons/fa'

function IconWrap({ children }: { children: ReactNode }) {
  return <div className="mb-3 text-primary-cc flex flex-col items-center justify-center text-center">{children}</div>
}

export default function Home() {
  return (
    <main className="min-h-screen text-slate-900">
      <AutoRedirect />

      {/* HERO */}
      <section className="hero-section relative flex min-h-screen items-center overflow-hidden py-12 text-white">
        <BackgroundVideo fixed />
        <div className="absolute inset-0 bg-slate-950/55" aria-hidden="true" />
        <div className="relative z-10 container mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 items-center gap-8">
            <div className="text-center">
              <div className="mx-auto max-w-xs sm:max-w-sm lg:max-w-md">
                <Image src="/logo-white.svg" width={420} height={100} alt="Civil Citizens" className="w-full h-auto" />
                <div className="text-center text-sm text-white/80 mt-2">Release: Beta 1.5</div>
              </div>
            </div>

            <div className="text-center lg:text-left">
              <h1 className="text-4xl font-extrabold mb-3 text-white">Together We Imagine an Ideal Society</h1>
              <p className="text-lg leading-relaxed text-white/90 mb-6">
                Civil gives every Canadian a platform based on <strong>real people, real communities, and real opportunity</strong>.
                <br className="hidden sm:block" /><br className="hidden sm:block" />
                No algorithms, no noise—your community comes first.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <Link href="/register" className="btn-primary-cc">Register</Link>
                <Link href="/login" className="btn-primary-cc">Login</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="bg-white text-slate-900">

        {/* NEW MAIN NAVIGATION EXPLAINER */}
        <section className="py-16">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-3xl font-bold mb-4">A Social Platform Built for Canadians</h2>
            <p className="text-lg text-slate-700 max-w-2xl mx-auto mb-10">
              Civil isn't a global shouting match. It's a <strong>Canadian-first network</strong> designed around the things that actually matter: your friends, your community, your work, and your local marketplace.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {/* Home */}
              <article className="benefit-card p-6 flex flex-col items-center text-center">
                <IconWrap><FaGlobeAmericas size={48} /></IconWrap>
                <h3 className="text-lg font-bold">Home</h3>
                <p className="text-slate-700 mt-3">Your personalized feed: friends, organizations, follows, and nearby community posts.</p>
              </article>

              {/* Friends */}
              <article className="benefit-card p-6 flex flex-col items-center text-center">
                <IconWrap><FaUsers size={48} /></IconWrap>
                <h3 className="text-lg font-bold">Friends</h3>
                <p className="text-slate-700 mt-3">A clean feed showing ONLY the friends you’ve connected with—no noise.</p>
              </article>

              {/* Community */}
              <article className="benefit-card p-6 flex flex-col items-center text-center">
                <IconWrap><FaBuilding size={48} /></IconWrap>
                <h3 className="text-lg font-bold">Community</h3>
                <p className="text-slate-700 mt-3">Your local riding’s Chamber of Citizens—neighbours, leaders, and local updates.</p>
              </article>

              {/* Market */}
              <article className="benefit-card p-6 flex flex-col items-center text-center">
                <IconWrap><FaStore size={48} /></IconWrap>
                <h3 className="text-lg font-bold">Market</h3>
                <p className="text-slate-700 mt-3">Shop local businesses or buy & sell items from verified citizens in your area.</p>
              </article>

              {/* Work */}
              <article className="benefit-card p-6 flex flex-col items-center text-center">
                <IconWrap><FaBriefcase size={48} /></IconWrap>
                <h3 className="text-lg font-bold">Work</h3>
                <p className="text-slate-700 mt-3">Local-first hiring & gig work. Jobs come from your community—not across the country.</p>
              </article>

              {/* Organizations */}
              <article className="benefit-card p-6 flex flex-col items-center text-center">
                <IconWrap><FaBuilding size={48} /></IconWrap>
                <h3 className="text-lg font-bold">Organizations</h3>
                <p className="text-slate-700 mt-3">Groups, clubs, local businesses, civic teams—join or create organizations that matter.</p>
              </article>

              {/* Events */}
              <article className="benefit-card p-6 flex flex-col items-center text-center">
                <IconWrap><FaHandshake size={48} /></IconWrap>
                <h3 className="text-lg font-bold">Events</h3>
                <p className="text-slate-700 mt-3">Townhalls, community meetups, business promos—see what’s happening locally.</p>
              </article>

              {/* Chat */}
              <article className="benefit-card p-6 flex flex-col items-center text-center">
                <IconWrap><FaComments size={48} /></IconWrap>
                <h3 className="text-lg font-bold">Chat</h3>
                <p className="text-slate-700 mt-3">Private, secure messaging between verified Canadians.</p>
              </article>

              {/* Wallet */}
              <article className="benefit-card p-6 flex flex-col items-center text-center">
                <IconWrap><FaWallet size={48} /></IconWrap>
                <h3 className="text-lg font-bold">Wallet</h3>
                <p className="text-slate-700 mt-3">Add funds, buy local, cash out, and even hire delivery gigs—all inside Civil.</p>
              </article>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="cta-section text-dark py-12 mt-6">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-3xl font-bold mb-3">Start Building Your Chamber of Citizens</h2>
            <p className="text-lg text-slate-700 mb-6">Stay informed. Support local. Keep politics civil.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/register" className="btn-primary-cc">Register</Link>
              <Link href="/login" className="btn-outline-primary-cc">Login</Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
