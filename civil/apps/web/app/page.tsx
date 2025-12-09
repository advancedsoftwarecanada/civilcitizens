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
  FaNewspaper,
  FaPodcast,
  FaMusic,
  FaPlayCircle,
  FaSeedling,
  FaTractor,
  FaStoreAlt,
  FaHandsHelping,
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
        <div className="absolute inset-0 bg-slate-950/65" aria-hidden="true" />
        <div className="relative z-10 container mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 items-center gap-8">
            <div className="text-center">
              <div className="mx-auto max-w-xs sm:max-w-sm lg:max-w-md">
                <Image src="/logo-white.svg" width={420} height={100} alt="Civil Citizens" className="w-full h-auto" />
                <div className="text-center text-sm text-white/80 mt-2">Release: Beta 1.5.1</div>
              </div>
            </div>

            <div className="text-center lg:text-left">
              <h1 className="text-4xl font-extrabold mb-3 text-white">Together We Imagine an Ideal Society</h1>
              <p className="text-lg leading-relaxed text-white/90 mb-6">
                Civil gives every Canadian a platform based on <strong>real people, real communities, and real opportunity</strong>—and a home for Canadian news, podcasts, music, and video creators.
                <br className="hidden sm:block" /><br className="hidden sm:block" />
                We must band together to form Chambers of Citizens with local small businesses leading the way!
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <Link href="/register" className="btn-primary-cc">Register</Link>
                <Link href="/login" className="btn-primary-cc">Login</Link>
              </div>
              <p className="mt-4 text-sm text-white/85">
                Plans start at just $2.99 a month. No selling your data. Just pure Canadian connection—and ads stay strictly Canadian-owned.
              </p>
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
              Civil isn't a global shouting match. It's a <strong>Canadian-first network</strong> designed around the things that actually matter: your friends, your community, your work, and your local marketplace—with Canadian creators sharing news, podcasts, music, and video.
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

            <div className="mt-12 space-y-4">
              <h3 className="text-2xl font-bold">Canadian content, Canadian creators</h3>
              <p className="text-slate-700 max-w-3xl mx-auto">
                We highlight Canadian-made news, podcasts, music, and video so audiences and creators can meet in one place.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
                <article className="benefit-card p-6 flex flex-col items-center text-center">
                  <IconWrap><FaNewspaper size={48} /></IconWrap>
                  <h3 className="text-lg font-bold">News</h3>
                  <p className="text-slate-700 mt-3">Local-first reporting and civic coverage from Canadian journalists and chambers.</p>
                </article>
                <article className="benefit-card p-6 flex flex-col items-center text-center">
                  <IconWrap><FaPodcast size={48} /></IconWrap>
                  <h3 className="text-lg font-bold">Podcasts</h3>
                  <p className="text-slate-700 mt-3">Conversations with Canadian hosts across culture, business, and public life.</p>
                </article>
                <article className="benefit-card p-6 flex flex-col items-center text-center">
                  <IconWrap><FaMusic size={48} /></IconWrap>
                  <h3 className="text-lg font-bold">Music</h3>
                  <p className="text-slate-700 mt-3">Spotlight Canadian artists and province-level charts to boost local talent.</p>
                </article>
                <article className="benefit-card p-6 flex flex-col items-center text-center">
                  <IconWrap><FaPlayCircle size={48} /></IconWrap>
                  <h3 className="text-lg font-bold">Video</h3>
                  <p className="text-slate-700 mt-3">Short and long-form video from Canadian creators with community context.</p>
                </article>
              </div>
              <div className="mt-12 space-y-4 text-center">
                <h3 className="text-2xl font-bold">Truly Made in Canada</h3>
                <p className="text-slate-700 max-w-3xl mx-auto">
                  Civil highlights local small farms, manufacturers, independent stores, and real jobs. Truly locally made goods. By keeping your money circulating here, we build a stronger economy together.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
                  <article className="benefit-card p-6 flex flex-col items-center text-center">
                    <IconWrap><FaSeedling size={48} /></IconWrap>
                    <h3 className="text-lg font-bold">Local farms</h3>
                    <p className="text-slate-700 mt-3">Fresh from Canadian soil, supporting growers in every province.</p>
                  </article>
                  <article className="benefit-card p-6 flex flex-col items-center text-center">
                    <IconWrap><FaTractor size={48} /></IconWrap>
                    <h3 className="text-lg font-bold">Makers & manufacturers</h3>
                    <p className="text-slate-700 mt-3">Built here—gear, goods, and essentials crafted by Canadian hands.</p>
                  </article>
                  <article className="benefit-card p-6 flex flex-col items-center text-center">
                    <IconWrap><FaStoreAlt size={48} /></IconWrap>
                    <h3 className="text-lg font-bold">Independent stores</h3>
                    <p className="text-slate-700 mt-3">Shop neighbourhood retailers and keep every dollar close to home.</p>
                  </article>
                  <article className="benefit-card p-6 flex flex-col items-center text-center">
                    <IconWrap><FaHandsHelping size={48} /></IconWrap>
                    <h3 className="text-lg font-bold">Real local jobs</h3>
                    <p className="text-slate-700 mt-3">Work and gigs from your community—circulating value where you live.</p>
                  </article>
                </div>
              </div>
              <div className="mt-12 space-y-4 text-center">
                <h3 className="text-2xl font-bold">Advertising, the Canadian way</h3>
                <p className="text-slate-700 max-w-3xl mx-auto">
                  Civil only shows ads from real Canadian makers and small businesses—every single one verified by hand so your feed supports the neighbour who built it, not a distant corporation.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* FOOTER HERO CTA */}
      <section className="hero-section relative overflow-hidden py-14 text-white">
          <BackgroundVideo fixed videoClassName="opacity-100" />
          <div className="absolute inset-0 bg-slate-950/40" aria-hidden="true" />
          <div className="relative z-10 container mx-auto px-4 text-center space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-white/70">Together We Imagine an Ideal Society</p>
            <h2 className="text-3xl font-bold sm:text-4xl">Start Building Your Chamber of Citizens</h2>
            <p className="text-lg text-white/85 max-w-2xl mx-auto">This is how communities support local business and build a better future together.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/register" className="btn-primary-cc">Register</Link>
              <Link href="/login" className="btn-primary-cc">Login</Link>
            </div>
            <p className="text-sm text-white/80">Plans start at $2.99/month. Ads verified Canadian-only. Your data stays yours.</p>
          </div>
        </section>
    </main>
  )
}
