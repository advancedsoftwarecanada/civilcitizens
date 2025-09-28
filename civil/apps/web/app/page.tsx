// @ts-nocheck
"use client"
import * as React from 'react'
import { useState } from 'react'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import Modal from './_components/Modal'
import AutoRedirect from './_components/AutoRedirect'
import {
  FaMapMarkedAlt,
  FaUserTie,
  FaCity,
  FaStore,
  FaUsers,
  FaMicrochip,
  FaHandshake,
  FaShieldAlt,
} from 'react-icons/fa'

function IconWrap({ children }: { children: React.ReactNode }) {
  return <div className="text-center mb-3 text-primary-cc">{children}</div>
}

export default function Home() {
  const [showLogin, setShowLogin] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const LoginForm = React.useMemo(() => dynamic(() => import('./login/page')), [])
  const RegisterForm = React.useMemo(() => dynamic(() => import('./register/page')), [])
  const ForgotForm = React.useMemo(() => dynamic(() => import('./forgot/page')), [])
  React.useEffect(() => {
    const openLogin = () => { setShowRegister(false); setShowLogin(true) }
    const openRegister = () => { setShowLogin(false); setShowRegister(true) }
    const openForgot = () => { setShowLogin(false); setShowRegister(false); setShowForgot(true) }
    window.addEventListener('openLoginModal', openLogin)
    window.addEventListener('openRegisterModal', openRegister)
    window.addEventListener('openForgotModal', openForgot)
    return () => {
      window.removeEventListener('openLoginModal', openLogin)
      window.removeEventListener('openRegisterModal', openRegister)
      window.removeEventListener('openForgotModal', openForgot)
    }
  }, [])
  return (
    <main className="bg-white min-h-screen text-slate-900">
      {/* Redirect signed-in users to /home */}
      <AutoRedirect />
      {/* Auth modals using shared component */}
      <Modal open={showLogin} onClose={() => setShowLogin(false)} title="Login">
        {/* @ts-ignore */}
        <LoginForm />
      </Modal>
      <Modal open={showRegister} onClose={() => setShowRegister(false)} title="Create your account">
        {/* @ts-ignore */}
        <RegisterForm />
      </Modal>
      <Modal open={showForgot} onClose={() => setShowForgot(false)} title="Reset your password">
        {/* @ts-ignore */}
        <ForgotForm />
      </Modal>
      {/* Hero */}
      <section className="hero-section py-12">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 items-center gap-8">
            <div className="text-center">
              <div className="mx-auto max-w-xs">
                <Image src="/logo.svg" width={420} height={100} alt="Civil Citizens" className="w-full h-auto" />
                <div className="text-center text-sm text-slate-500 mt-2">Release: Beta 1.0</div>
              </div>
            </div>
            <div className="text-center lg:text-left">
              <h1 className="text-4xl font-extrabold mb-3">Chambers of Citizens</h1>
              <p className="text-lg leading-relaxed text-slate-700 mb-6">
                Every Canadian lives in an <strong>Electoral District Association (EDA)</strong>.
                <br className="hidden sm:block" />
                <br className="hidden sm:block" />
                Civil turns that fact into action by forming a <strong>Chamber of Citizens</strong> for your riding — a real local forum where <strong>citizens, MPs, city councils, and local businesses</strong> talk openly and get things done, grounded by @Civil AI’s plain-English, cited facts.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <button onClick={() => setShowRegister(true)} className="btn-primary-cc">Register</button>
                <button onClick={() => setShowLogin(true)} className="btn-outline-primary-cc">Login</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Everyone In One Room */}
      <section id="stakeholders" className="py-0">
        <div className="section-hero-banner">
          <div className="container mx-auto px-4">
            <div className="text-center">
              <h2 className="text-3xl font-bold">Everyone In One Room</h2>
              <p className="text-slate-600 mt-2">Six voices, one Chamber — organized by your <strong>Electoral District Association (EDA)</strong>.</p>
            </div>
          </div>
        </div>
        <div className="cards-slab">
          <div className="container mx-auto px-4 py-10">
            <div className="benefit-grid">
              {/* EDA */}
              <article className="benefit-card">
                <div className="p-6">
                  <IconWrap><FaMapMarkedAlt size={48} /></IconWrap>
                  <h3 className="text-lg font-bold text-center">Electoral District Association (EDA)</h3>
                  <ul className="mt-3 space-y-3 text-slate-700">
                    <li className="cc-li">One home for everything happening in your riding</li>
                    <li className="cc-li">Meet neighbours, officials, and local businesses in one place</li>
                    <li className="cc-li">See timely, relevant updates without the national noise</li>
                  </ul>
                </div>
              </article>

              {/* MPs */}
              <article className="benefit-card">
                <div className="p-6">
                  <IconWrap><FaUserTie size={48} /></IconWrap>
                  <h3 className="text-lg font-bold text-center">Federal & Provincial MPs</h3>
                  <ul className="mt-3 space-y-3 text-slate-700">
                    <li className="cc-li">Reach constituents with clear, plain-language updates</li>
                    <li className="cc-li">Hear structured feedback from real people in your EDA</li>
                    <li className="cc-li">Host townhalls that turn discussion into action</li>
                  </ul>
                </div>
              </article>

              {/* City Councils */}
              <article className="benefit-card">
                <div className="p-6">
                  <IconWrap><FaCity size={48} /></IconWrap>
                  <h3 className="text-lg font-bold text-center">City Councils</h3>
                  <ul className="mt-3 space-y-3 text-slate-700">
                    <li className="cc-li">Get important notices in front of the right residents</li>
                    <li className="cc-li">Coordinate faster across neighbouring municipalities</li>
                    <li className="cc-li">Escalate local concerns to MPs with community backing</li>
                  </ul>
                </div>
              </article>

              {/* Businesses */}
              <article className="benefit-card">
                <div className="p-6">
                  <IconWrap><FaStore size={48} /></IconWrap>
                  <h3 className="text-lg font-bold text-center">Businesses</h3>
                  <ul className="mt-3 space-y-3 text-slate-700">
                    <li className="cc-li">Be discovered by people who actually live and shop here</li>
                    <li className="cc-li">Join civic conversations that affect your costs and customers</li>
                    <li className="cc-li">Find partners and talent nearby—grow local</li>
                  </ul>
                </div>
              </article>

              {/* Citizens */}
              <article className="benefit-card">
                <div className="p-6">
                  <IconWrap><FaUsers size={48} /></IconWrap>
                  <h3 className="text-lg font-bold text-center">Citizens</h3>
                  <ul className="mt-3 space-y-3 text-slate-700">
                    <li className="cc-li">Stay current with EDA-based news and MP updates</li>
                    <li className="cc-li">Discuss local problems respectfully; find solutions</li>
                    <li className="cc-li">Join actions: townhalls, petitions, volunteer drives</li>
                  </ul>
                </div>
              </article>

              {/* Civil AI */}
              <article className="benefit-card">
                <div className="p-6">
                  <IconWrap><FaMicrochip size={48} /></IconWrap>
                  <h3 className="text-lg font-bold text-center">@Civil AI</h3>
                  <ul className="mt-3 space-y-3 text-slate-700">
                    <li className="cc-li">Turns Hansard into plain-speak with citations</li>
                    <li className="cc-li">Neutral, sourced corrections to keep debate fair</li>
                    <li className="cc-li">Context for bills, MPs, and riding changes—so you don’t have to Google</li>
                  </ul>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>

      {/* Three Pillars */}
      <section id="pillars" className="py-0">
        <div className="section-hero-banner">
          <div className="container mx-auto px-4">
            <div className="text-center">
              <h2 className="text-3xl font-bold">Why Join Civil Citizens?</h2>
              <p className="text-slate-600 mt-2">The core of a civilized network — clear information, real opportunities, and real people.</p>
            </div>
          </div>
        </div>
        <div className="cards-slab">
          <div className="container mx-auto px-4 py-10">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {/* Hansard */}
              <article className="benefit-card">
                <div className="p-6">
                  <h3 className="text-lg font-bold">Know What Your Elected Reps Did Today</h3>
                  <p className="text-slate-700 mt-3">Stay up to date with your <strong>federal, provincial, and municipal</strong> representatives—without watching hours of video.</p>
                  <ul className="mt-3 space-y-3 text-slate-700">
                    <li className="cc-li">See what your MP and councillors said today, in minutes</li>
                    <li className="cc-li">Understand how it affects your riding right now</li>
                    <li className="cc-li">Go deeper any time with linked sources</li>
                  </ul>
                  <div className="mt-4">
                    <button onClick={() => setShowLogin(true)} className="btn-outline-primary-cc btn-sm">Stay Updated</button>
                  </div>
                </div>
              </article>

              {/* Hiring */}
              <article className="benefit-card">
                <div className="p-6">
                  <h3 className="text-lg font-bold">Hire Faster With Local Matches</h3>
                  <p className="text-slate-700 mt-3">Turn a job post into ready-to-interview shortlists from people in your community.</p>
                  <ul className="mt-3 space-y-3 text-slate-700">
                    <li className="cc-li">Cut time-to-hire—meet qualified locals first</li>
                    <li className="cc-li">No resume pile—only strong, relevant candidates</li>
                    <li className="cc-li">Lower recruiting spend, better retention from hiring nearby</li>
                  </ul>
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => setShowLogin(true)} className="btn-primary-cc btn-sm">Post a Job</button>
                    <button onClick={() => setShowLogin(true)} className="btn-outline-primary-cc btn-sm">Find Work</button>
                  </div>
                </div>
              </article>

              {/* Verification */}
              <article className="benefit-card">
                <div className="p-6">
                  <h3 className="text-lg font-bold">Real People. Real Businesses.</h3>
                  <p className="text-slate-700 mt-3">Fewer scams and better conversations because everyone is who they say they are.</p>
                  <ul className="mt-3 space-y-3 text-slate-700">
                    <li className="cc-li">Talk to verified citizens—no bots, less spam</li>
                    <li className="cc-li">Deal with verified companies you can trust</li>
                    <li className="cc-li">Earn a badge that boosts replies and conversions</li>
                  </ul>
                  <div className="mt-4">
                    <button onClick={() => setShowLogin(true)} className="btn-outline-primary-cc btn-sm">Get Verified</button>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>

      {/* Local Marketplace */}
      <section id="marketplace" className="py-0">
        <div className="section-hero-banner">
          <div className="container mx-auto px-4">
            <div className="text-center">
              <h2 className="text-3xl font-bold">Local Marketplace</h2>
              <p className="text-slate-600 mt-2">Shop your Chamber—keep money in the riding. No dropshipping. No big-box ads.</p>
            </div>
          </div>
        </div>
        <div className="cards-slab">
          <div className="container mx-auto px-4 py-10">
            <div className="market-grid">
              {/* Shop Local */}
              <article className="benefit-card">
                <div className="p-6">
                  <IconWrap><FaStore size={48} /></IconWrap>
                  <h3 className="text-lg font-bold text-center">Shop Local Businesses</h3>
                  <ul className="mt-3 space-y-3 text-slate-700">
                    <li className="cc-li">Verified businesses inside your EDA</li>
                    <li className="cc-li">Pickup or local delivery only</li>
                    <li className="cc-li">Keep dollars circulating locally</li>
                  </ul>
                  <div className="text-center mt-6">
                    <button onClick={() => setShowLogin(true)} className="btn-outline-primary-cc btn-lg">Browse Marketplace</button>
                  </div>
                </div>
              </article>

              {/* Buy & Sell */}
              <article className="benefit-card">
                <div className="p-6">
                  <IconWrap><FaHandshake size={48} /></IconWrap>
                  <h3 className="text-lg font-bold text-center">Buy &amp; Sell with Neighbours</h3>
                  <ul className="mt-3 space-y-3 text-slate-700">
                    <li className="cc-li">In-app chat, meet up locally</li>
                    <li className="cc-li">Anti-dropship checks, real photos</li>
                    <li className="cc-li">Safety tips &amp; easy reporting</li>
                  </ul>
                  <div className="text-center mt-6">
                    <button onClick={() => setShowLogin(true)} className="btn-outline-primary-cc btn-lg">List an Item</button>
                  </div>
                </div>
              </article>
            </div>

            <p className="text-center text-slate-500 text-sm mt-6 mb-0 flex items-center justify-center gap-2">
              <FaShieldAlt className="text-slate-400" />
              Local-only policy: no dropshipping, no big-box store ads, pickup/delivery within your EDA.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section text-dark py-12 mt-6">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-3">Start Building Your Chamber of Citizens</h2>
          <p className="text-lg text-slate-700 mb-6">Stay informed. Solve problems together. Keep politics civil.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={() => setShowRegister(true)} className="btn-primary-cc">Register</button>
            <button onClick={() => setShowLogin(true)} className="btn-outline-primary-cc">Login</button>
          </div>
        </div>
      </section>
    </main>
  )
}
