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
  FaVideo,
  FaFileContract,
  FaCar,
  FaLandmark,
  FaBalanceScale,
  FaIdCard,
  FaChartLine,
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
                <div className="text-center text-sm text-white/80 mt-2">Release 1.6.0 — Jan 7, 2026</div>
              </div>
            </div>

            <div className="text-center lg:text-left">
              <p className="text-sm sm:text-base font-semibold uppercase tracking-[0.35em] text-white/80 mb-3">Community. Commerce. Careers. Coordination.</p>
              <h1 className="text-4xl font-extrabold mb-3 text-white">Canada’s Community, Commerce & Careers Platform.</h1>
              <p className="text-lg leading-relaxed text-white/90 mb-6">
                Built for <strong>real people, real businesses, and real opportunity</strong>—all inside one Canadian system.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <Link href="/register" className="btn-primary-cc">Register</Link>
                <Link href="/login" className="btn-primary-cc">Login</Link>
              </div>
              <p className="mt-4 text-sm text-white/85">
                Plans start at $2.99/month. No selling your data. Ads stay strictly Canadian-owned.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* COMMUNITY */}
      <section className="bg-white py-16">
        <div className="container mx-auto px-4 text-center">
          <p className="text-sm sm:text-base font-semibold uppercase tracking-[0.3em] text-slate-500 mb-3">🔷 Community</p>
          <h2 className="text-3xl font-bold mb-4">Your people. Your riding. Your Canada.</h2>
          <p className="text-lg text-slate-700 max-w-2xl mx-auto mb-10">Civil is built around verified Canadians and real communities — not global noise.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8 max-w-6xl mx-auto">
            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaGlobeAmericas size={48} /></IconWrap>
              <h3 className="text-lg font-bold">Home</h3>
              <p className="text-slate-700 mt-3">Your personalized feed: friends, organizations, and nearby updates.</p>
            </article>

            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaUsers size={48} /></IconWrap>
              <h3 className="text-lg font-bold">Friends</h3>
              <p className="text-slate-700 mt-3">A clean feed showing only people you’ve chosen.</p>
            </article>

            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaBuilding size={48} /></IconWrap>
              <h3 className="text-lg font-bold">Community</h3>
              <p className="text-slate-700 mt-3">Your local Chamber of Citizens — neighbours, leaders, local updates.</p>
            </article>

            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaBuilding size={48} /></IconWrap>
              <h3 className="text-lg font-bold">Organizations</h3>
              <p className="text-slate-700 mt-3">Groups, clubs, local businesses, civic teams—join or create organizations that matter.</p>
            </article>

            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaHandshake size={48} /></IconWrap>
              <h3 className="text-lg font-bold">Events</h3>
              <p className="text-slate-700 mt-3">Townhalls, meetups, business promotions — all locally grounded.</p>
            </article>

            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaComments size={48} /></IconWrap>
              <h3 className="text-lg font-bold">Chat</h3>
              <p className="text-slate-700 mt-3">Private, secure messaging between verified Canadians.</p>
            </article>

            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaNewspaper size={48} /></IconWrap>
              <h3 className="text-lg font-bold">News</h3>
              <p className="text-slate-700 mt-3">Local reporting grounded in your riding.</p>
            </article>

            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaPodcast size={48} /></IconWrap>
              <h3 className="text-lg font-bold">Podcasts</h3>
              <p className="text-slate-700 mt-3">Conversations with Canadian hosts.</p>
            </article>

            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaMusic size={48} /></IconWrap>
              <h3 className="text-lg font-bold">Music</h3>
              <p className="text-slate-700 mt-3">Discover and support Canadian artists.</p>
            </article>

            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaVideo size={48} /></IconWrap>
              <h3 className="text-lg font-bold">Video</h3>
              <p className="text-slate-700 mt-3">Short and long-form content from verified creators.</p>
            </article>
          </div>

          <p className="mt-10 text-slate-700 max-w-3xl mx-auto">
            A home for Canadian creators and local reporting — grounded in community context.
          </p>
        </div>
      </section>

      {/* COMMERCE */}
      <section className="bg-white py-16">
        <div className="container mx-auto px-4 text-center">
          <p className="text-sm sm:text-base font-semibold uppercase tracking-[0.3em] text-slate-500 mb-3">🔷 Commerce</p>
          <h2 className="text-3xl font-bold mb-4">Keep opportunity inside Canada.</h2>
          <p className="text-lg text-slate-700 max-w-2xl mx-auto mb-10">Buy local, sell local, and transact safely in a verified Canadian network.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaStore size={48} /></IconWrap>
              <h3 className="text-lg font-bold">Market</h3>
              <p className="text-slate-700 mt-3">Buy & sell with verified citizens and businesses.</p>
            </article>
            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaWallet size={48} /></IconWrap>
              <h3 className="text-lg font-bold">Wallet</h3>
              <p className="text-slate-700 mt-3">Add funds, transact, and cash out — inside one Canadian system.</p>
            </article>

            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaFileContract size={48} /></IconWrap>
              <h3 className="text-lg font-bold">Contracts</h3>
              <p className="text-slate-700 mt-3">Create service agreements for gig work, delivery, pickups, installations, or custom jobs — with clear terms and verified participants.</p>
            </article>

            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaCar size={48} /></IconWrap>
              <h3 className="text-lg font-bold">Rides</h3>
              <p className="text-slate-700 mt-3">Book local rides and transportation inside the same trusted Canadian network — fast, convenient, and community-powered.</p>
            </article>
          </div>
        </div>
      </section>

      {/* CIVIL CAREERS */}
      <section className="hero-section relative overflow-hidden py-14 text-white">
        <BackgroundVideo fixed />
        <div className="absolute inset-0 bg-slate-950/65" aria-hidden="true" />
        <div className="relative z-10 container mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 items-center gap-8">
            <div className="hidden lg:flex items-center justify-center">
              <div className="mx-auto max-w-xs sm:max-w-sm lg:max-w-md">
                <Image src="/logo-white.svg" width={420} height={100} alt="Civil Citizens" className="w-full h-auto" />
              </div>
            </div>

            <div className="text-center lg:text-left">
              <p className="text-sm sm:text-base font-semibold uppercase tracking-[0.3em] text-white/80 mb-3">🔷 Civil Careers</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-white">Built for Canadian Professionals.</h2>
              <p className="text-white/90 mt-4">
                Civil connects Canadian talent with Canadian opportunity — without vanity metrics or algorithm games.
              </p>

              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <Link href="/register" className="btn-primary-cc">Register</Link>
                <Link href="/login" className="btn-primary-cc">Login</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="container mx-auto px-4 text-center space-y-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaBriefcase size={42} /></IconWrap>
              <h3 className="text-lg font-bold">Professional Profiles</h3>
              <p className="text-slate-700 mt-3">Highlight skills, certifications, and achievements — built for substance.</p>
            </article>
            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaGlobeAmericas size={42} /></IconWrap>
              <h3 className="text-lg font-bold">Canadian Job Network</h3>
              <p className="text-slate-700 mt-3">Discover opportunities from Canadian businesses. Search locally or nationally.</p>
            </article>
            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaBuilding size={42} /></IconWrap>
              <h3 className="text-lg font-bold">Follow Canadian Companies</h3>
              <p className="text-slate-700 mt-3">Track hiring, growth, and updates directly inside Civil.</p>
            </article>
            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaHandshake size={42} /></IconWrap>
              <h3 className="text-lg font-bold">Direct Professional Connections</h3>
              <p className="text-slate-700 mt-3">Connect with operators, founders, trades, producers, and professionals across Canada.</p>
            </article>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-6xl mx-auto">
            <div className="benefit-card p-6 text-left">
              <h3 className="text-xl font-bold text-slate-900">🛠 Built for Builders</h3>
              <p className="text-slate-700 mt-3">Entrepreneurs. Tradespeople. Farmers. Retailers. Technicians. Engineers. Operators. Managers. Students.</p>
            </div>

            <div className="benefit-card p-6 text-left">
              <h3 className="text-xl font-bold text-slate-900">📊 Integrated with Civil Commerce</h3>
              <div className="mt-4 space-y-2 text-slate-700">
                <p>• Post jobs directly from their business profile</p>
                <p>• Hire inside the same system they operate in</p>
                <p>• Verify reputation through real network participation</p>
              </div>
              <p className="text-slate-900 font-semibold mt-4">One platform. Community. Commerce. Careers.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CIVIL FOR BUSINESS */}
      <section className="hero-section relative overflow-hidden py-14 text-white">
        <BackgroundVideo fixed />
        <div className="absolute inset-0 bg-slate-950/65" aria-hidden="true" />
        <div className="relative z-10 container mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 items-center gap-8">
            <div className="hidden lg:flex items-center justify-center">
              <div className="mx-auto max-w-xs sm:max-w-sm lg:max-w-md">
                <Image src="/logo-white.svg" width={420} height={100} alt="Civil Citizens" className="w-full h-auto" />
              </div>
            </div>

            <div className="text-center lg:text-left">
              <p className="text-sm sm:text-base font-semibold uppercase tracking-[0.3em] text-white/80 mb-3">🔷 Civil For Business</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-white">Run your business inside Canada’s integrated platform.</h2>
              <p className="text-white/90 mt-4">One operating system for commerce — online and in-store.</p>

              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <Link href="/register" className="btn-primary-cc">Register</Link>
                <Link href="/login" className="btn-primary-cc">Login</Link>
              </div>

              <div className="mt-6 rounded-2xl border border-white/20 bg-white/10 p-6 text-left backdrop-blur-sm">
                <p className="text-white/90">Online and in-store commerce, unified.</p>
                <p className="text-white/90 mt-2">Manage supply, contracts, and delivery in one place.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="container mx-auto px-4 text-center space-y-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaStore size={42} /></IconWrap>
              <h3 className="text-lg font-bold">Sell online + in-store</h3>
              <p className="text-slate-700 mt-3">Manage customers, orders, and inventory in one place.</p>
            </article>
            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaGlobeAmericas size={42} /></IconWrap>
              <h3 className="text-lg font-bold">Real-Time Supply Visibility</h3>
              <p className="text-slate-700 mt-3">See buying signals. Discover suppliers. Reduce waste.</p>
            </article>
            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaHandshake size={42} /></IconWrap>
              <h3 className="text-lg font-bold">Built-In Canadian Network</h3>
              <p className="text-slate-700 mt-3">Connect directly with verified businesses nationwide.</p>
            </article>
            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaBriefcase size={42} /></IconWrap>
              <h3 className="text-lg font-bold">Contracts & Delivery Included</h3>
              <p className="text-slate-700 mt-3">Create contracts at checkout and coordinate delivery in the same workflow.</p>
            </article>
          </div>

          <p className="text-slate-900 font-semibold">One system. Not five.</p>
        </div>
      </section>

      {/* COORDINATION */}
      <section className="bg-white py-16">
        <div className="container mx-auto px-4 text-center">
          <p className="text-sm sm:text-base font-semibold uppercase tracking-[0.3em] text-slate-500 mb-3">🔷 Coordination</p>
          <h2 className="text-3xl font-bold mb-4">Contracts and delivery that actually ship.</h2>
          <p className="text-lg text-slate-700 max-w-2xl mx-auto mb-10">Coordinate real-world work inside the same system as your community and commerce.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaBriefcase size={42} /></IconWrap>
              <h3 className="text-lg font-bold">Contracts at checkout</h3>
              <p className="text-slate-700 mt-3">Define pickup, drop-off, timing, and service scope clearly.</p>
            </article>
            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaHandshake size={42} /></IconWrap>
              <h3 className="text-lg font-bold">Local delivery dispatch</h3>
              <p className="text-slate-700 mt-3">Hire verified movers and drivers without jumping between tools.</p>
            </article>
            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaUsers size={42} /></IconWrap>
              <h3 className="text-lg font-bold">Verified participants</h3>
              <p className="text-slate-700 mt-3">Work with real Canadians in a trusted network — less fraud, less friction.</p>
            </article>
          </div>
        </div>
      </section>

      {/* CIVIL AI */}
      <section className="hero-section relative overflow-hidden py-14 text-white">
        <BackgroundVideo fixed />
        <div className="absolute inset-0 bg-slate-950/65" aria-hidden="true" />
        <div className="relative z-10 container mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 items-center gap-8">
            <div className="hidden lg:flex items-center justify-center">
              <div className="mx-auto max-w-xs sm:max-w-sm lg:max-w-md">
                <Image src="/logo-white.svg" width={420} height={100} alt="Civil Citizens" className="w-full h-auto" />
              </div>
            </div>

            <div className="text-center lg:text-left">
              <p className="text-sm sm:text-base font-semibold uppercase tracking-[0.3em] text-white/80 mb-3">🔷 Introducing Civil AI</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-white">The Intelligence Layer for Canadian Community & Commerce</h2>
              <p className="text-white/90 mt-4">
                Built specifically for Canada — our markets, regulations, and communities.
              </p>
              <p className="text-white/90 mt-3">
                Civil AI strengthens business operations, improves conversation, and helps Canadians coordinate in real life.
              </p>
              <p className="text-white/90 mt-3">Designed to increase trust, fairness, participation, and revenue — without silencing legitimate voices.</p>

              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <Link href="/register" className="btn-primary-cc">Register</Link>
                <Link href="/login" className="btn-primary-cc">Login</Link>
              </div>

              <div className="mt-6 rounded-2xl border border-white/20 bg-white/10 p-6 text-left backdrop-blur-sm">
                <p className="text-lg font-semibold text-white mb-3">🔍 Transparent & Accountable</p>
                <p className="text-white/90">Civil AI decisions are clearly labeled. Moderation actions can be reviewed. Users remain in control of notification and participation settings.</p>
                <p className="text-white/90 mt-3">Civil AI supports Canadians — it doesn’t control them.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="container mx-auto px-4 text-center space-y-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaGlobeAmericas size={42} /></IconWrap>
              <h3 className="text-lg font-bold">Built for Canada</h3>
              <p className="text-slate-700 mt-3">Understands regional markets and Canadian regulatory realities.</p>
            </article>

            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaComments size={42} /></IconWrap>
              <h3 className="text-lg font-bold">Civil Conversation</h3>
              <p className="text-slate-700 mt-3">Encourages respectful dialogue. Adds context. Clearly labels AI signals.</p>
            </article>

            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaStore size={42} /></IconWrap>
              <h3 className="text-lg font-bold">Commerce Intelligence</h3>
              <p className="text-slate-700 mt-3">Matches supply and demand. Identifies trends. Structures fulfillment workflows.</p>
            </article>

            <article className="benefit-card p-6 flex flex-col items-center text-center">
              <IconWrap><FaUsers size={42} /></IconWrap>
              <h3 className="text-lg font-bold">Community Coordination</h3>
              <p className="text-slate-700 mt-2 font-medium">“Hey Civil, organize a tee time Saturday.”</p>
              <div className="mt-3 text-left w-full max-w-xs text-slate-700 space-y-1">
                <p>• Notify your opted-in group</p>
                <p>• Suggest optimal times</p>
                <p>• Coordinate confirmations</p>
                <p>• Send reminders</p>
              </div>
              <p className="text-slate-700 mt-3">Less friction. More participation.</p>
            </article>
          </div>

          <div className="pt-4">
            <p className="text-sm sm:text-base font-semibold uppercase tracking-[0.3em] text-slate-500 mb-3">🔷 Chambers of Citizens</p>
            <h2 className="text-3xl font-bold mb-4">Civic transparency, organized by electoral district.</h2>
            <p className="text-lg text-slate-700 max-w-3xl mx-auto mb-10">
              When you join Civil, you are automatically placed inside your municipal ward, provincial riding, and federal electoral district — aligned with Canada’s real voting structure.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
              <article className="benefit-card p-6 flex flex-col items-center text-center">
                <IconWrap><FaLandmark size={42} /></IconWrap>
                <h3 className="text-lg font-bold">Public Representation</h3>
                <p className="text-slate-700 mt-3">See current elected officials at municipal, provincial, and federal levels.</p>
              </article>

              <article className="benefit-card p-6 flex flex-col items-center text-center">
                <IconWrap><FaBalanceScale size={42} /></IconWrap>
                <h3 className="text-lg font-bold">Voting Records</h3>
                <p className="text-slate-700 mt-3">Access publicly available voting history and official decisions.</p>
              </article>

              <article className="benefit-card p-6 flex flex-col items-center text-center">
                <IconWrap><FaIdCard size={42} /></IconWrap>
                <h3 className="text-lg font-bold">Official Contacts</h3>
                <p className="text-slate-700 mt-3">View verified office information and communication channels.</p>
              </article>

              <article className="benefit-card p-6 flex flex-col items-center text-center">
                <IconWrap><FaChartLine size={42} /></IconWrap>
                <h3 className="text-lg font-bold">Local Legislative Signals</h3>
                <p className="text-slate-700 mt-3">Civil AI surfaces relevant council, provincial, and federal developments affecting your district.</p>
              </article>

              <article className="benefit-card p-6 flex flex-col items-center text-center">
                <IconWrap><FaComments size={42} /></IconWrap>
                <h3 className="text-lg font-bold">Structured Discussion</h3>
                <p className="text-slate-700 mt-3">Discuss civic issues inside your real electoral community — grounded in representation, not anonymous chaos.</p>
              </article>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER HERO CTA */}
      <section className="hero-section relative overflow-hidden py-14 text-white">
        <BackgroundVideo fixed videoClassName="opacity-100" />
        <div className="absolute inset-0 bg-slate-950/40" aria-hidden="true" />
        <div className="relative z-10 container mx-auto px-4 text-center space-y-4">
          <div className="mx-auto max-w-xs sm:max-w-sm">
            <Image src="/logo-white.svg" width={420} height={100} alt="Civil Citizens" className="w-full h-auto" />
          </div>
          <div className="max-w-3xl mx-auto space-y-3">
            <p className="text-sm sm:text-base font-semibold uppercase tracking-[0.35em] text-white/80">Community. Commerce. Careers. Coordination.</p>
            <p className="text-lg text-white/90">All inside one Canadian platform.</p>
            <div className="text-lg font-semibold text-white max-w-2xl mx-auto space-y-1">
              <p>Build your network.</p>
              <p>Run your business.</p>
              <p>Grow your career.</p>
              <p>All in Canada.</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/register" className="btn-primary-cc">Register</Link>
            <Link href="/login" className="btn-primary-cc">Login</Link>
          </div>
          <p className="text-sm text-white/85">Ads are verified Canadian-only. No selling your data.</p>
        </div>
      </section>
    </main>
  )
}
