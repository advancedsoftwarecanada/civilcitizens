import type { ReactNode } from 'react'
import type { IconType } from 'react-icons'
import Image from 'next/image'
import Link from 'next/link'
import AuthAwareCtaButton from './AuthAwareCtaButton'
import {
  FaArrowRight,
  FaCarSide,
  FaCheckCircle,
  FaCreditCard,
  FaDollarSign,
  FaLeaf,
  FaMapMarkedAlt,
  FaReceipt,
  FaRoad,
  FaShieldAlt,
  FaSlidersH,
  FaStore,
  FaUsers,
} from 'react-icons/fa'

const heroHighlights = [
  {
    icon: FaDollarSign,
    title: 'Drivers set their own prices',
    description: 'A marketplace model that gives drivers more control over every trip.',
  },
  {
    icon: FaReceipt,
    title: 'Simple flat fee',
    description: 'MapleRides keeps pricing straightforward with a small flat fee per ride.',
  },
  {
    icon: FaCreditCard,
    title: 'Secure Stripe payments',
    description: 'Payments are processed securely through Stripe for drivers and riders.',
  },
]

const whyMapleRidesCards = [
  {
    icon: FaDollarSign,
    title: 'Drivers keep more of every ride',
    description: 'More of the fare stays with the person doing the work.',
  },
  {
    icon: FaSlidersH,
    title: 'Drivers set their own prices',
    description: 'Drivers choose the price that fits the trip.',
  },
  {
    icon: FaRoad,
    title: 'No surge pricing',
    description: 'Riders do not get hit with surprise spikes.',
  },
  {
    icon: FaReceipt,
    title: 'Simple flat fee model',
    description: 'Pricing stays easy to understand on both sides of the ride.',
  },
  {
    icon: FaCreditCard,
    title: 'Secure payments powered by Stripe',
    description: 'Modern checkout and payout flows with trusted payment processing.',
  },
  {
    icon: FaMapMarkedAlt,
    title: 'Built for cities, towns, and communities across Canada',
    description: 'A ride network designed for how Canadians actually move.',
  },
]

const driverFeatures = [
  'Small flat fee per ride',
  'Set your own prices',
  'No forced surge pricing',
  'No MapleRides withdrawal fee',
  'Secure payouts with Stripe',
]

const riderFeatures = [
  'No surge pricing',
  'Transparent ride pricing',
  'Support local Canadian drivers',
  'Simple booking experience',
  'Secure online payments',
]

const trustFeatures = [
  {
    icon: FaCreditCard,
    title: 'Secure payments powered by Stripe',
    description: 'A familiar checkout layer built for secure online payments.',
  },
  {
    icon: FaUsers,
    title: 'Driver and rider trust features',
    description: 'A platform built to help both sides transact with more confidence.',
  },
  {
    icon: FaReceipt,
    title: 'Built for transparent transactions',
    description: 'Clear pricing and simple fees are part of the product, not an afterthought.',
  },
  {
    icon: FaShieldAlt,
    title: 'Modern platform experience',
    description: 'Fast, clean, and easy to use on mobile or desktop.',
  },
]

const coverageCards = [
  {
    icon: FaCarSide,
    title: 'Major cities',
    description: 'A fairer option for busy urban trips and everyday local demand.',
  },
  {
    icon: FaStore,
    title: 'Regional hubs',
    description: 'Flexible local supply helps communities grow their own ride coverage.',
  },
  {
    icon: FaLeaf,
    title: 'Small towns and communities',
    description: 'Big city or small town, if there is a driver, there can be a ride.',
  },
]

function SectionShell({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={className}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  )
}

function SectionIntro({
  eyebrow,
  title,
  description,
  centered = false,
  dark = false,
}: {
  eyebrow: string
  title: string
  description: string
  centered?: boolean
  dark?: boolean
}) {
  const wrapperClassName = centered ? 'mx-auto max-w-3xl text-center' : 'max-w-2xl'

  return (
    <div className={wrapperClassName}>
      <p className={`text-sm font-semibold uppercase tracking-[0.32em] ${dark ? 'text-red-300' : 'text-red-600'}`}>{eyebrow}</p>
      <h2 className={`mt-4 text-3xl font-black tracking-[-0.04em] sm:text-4xl ${dark ? 'text-white' : 'text-slate-950'}`}>{title}</h2>
      <p className={`mt-5 text-base leading-7 sm:text-lg ${dark ? 'text-slate-200' : 'text-slate-600'}`}>{description}</p>
    </div>
  )
}

function CtaRow({ final = false, light = false }: { final?: boolean; light?: boolean }) {
  const secondaryLabel = final ? 'Become a Driver' : 'Drive with MapleRides'
  const secondaryClassName = light
    ? 'border border-white/30 bg-white/10 text-white hover:bg-white/20'
    : 'border border-slate-300 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50'

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <AuthAwareCtaButton
        ariaLabel="Book a Ride"
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#d9222a] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(217,34,42,0.26)] transition hover:bg-[#bd1d24] sm:w-auto"
      >
        Book a Ride
        <FaArrowRight className="text-xs" aria-hidden="true" />
      </AuthAwareCtaButton>
      <AuthAwareCtaButton
        ariaLabel={secondaryLabel}
        className={`inline-flex w-full items-center justify-center rounded-full px-6 py-3.5 text-sm font-semibold transition sm:w-auto ${secondaryClassName}`}
      >
        {secondaryLabel}
      </AuthAwareCtaButton>
    </div>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  dark = false,
}: {
  icon: IconType
  title: string
  description: string
  dark?: boolean
}) {
  return (
    <article
      className={
        dark
          ? 'rounded-[1.6rem] border border-white/10 bg-white/5 p-6 text-white'
          : 'rounded-[1.6rem] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]'
      }
    >
      <div
        className={
          dark
            ? 'flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-white'
            : 'flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-red-600'
        }
      >
        <Icon aria-hidden="true" />
      </div>
      <h3 className={`mt-5 text-lg font-bold tracking-[-0.03em] ${dark ? 'text-white' : 'text-slate-950'}`}>{title}</h3>
      <p className={`mt-3 text-sm leading-6 ${dark ? 'text-slate-200' : 'text-slate-600'}`}>{description}</p>
    </article>
  )
}

function Checklist({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-3">
      {items.map((item) => (
        <li
          key={item}
          className="flex items-start gap-3 rounded-[1.2rem] border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700"
        >
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-50 text-xs text-red-600">
            <FaCheckCircle aria-hidden="true" />
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export default function MapleRidesLandingPage() {
  return (
    <main className="relative isolate overflow-hidden bg-[#f7f3ee] text-slate-950">
      <section className="relative overflow-hidden bg-[linear-gradient(135deg,#09111d_0%,#111827_42%,#7f1d1d_100%)] text-white">
        <div className="absolute left-[-6rem] top-16 h-72 w-72 rounded-full bg-red-500/20 blur-3xl" aria-hidden="true" />
        <div className="absolute right-[-4rem] top-28 h-80 w-80 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
        <div className="relative z-10 mx-auto max-w-6xl px-4 pb-20 pt-6 sm:px-6 sm:pb-24 lg:px-8 lg:pb-28 lg:pt-8">
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/"
              aria-label="MapleRides home"
              className="inline-flex rounded-[1.4rem] bg-white/95 px-4 py-3 shadow-[0_18px_60px_rgba(2,6,23,0.22)]"
            >
              <Image
                src="/Maple-Rides.png"
                alt="MapleRides logo"
                width={772}
                height={441}
                priority
                className="h-auto w-[180px] sm:w-[220px]"
              />
            </Link>
            <div className="hidden md:flex">
              <CtaRow light />
            </div>
          </div>

          <div className="grid gap-10 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)] lg:items-center lg:gap-16">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.32em] text-red-100/80">Canadian owned rides platform</p>
              <h1 className="mt-5 max-w-[12ch] text-4xl font-black leading-[0.96] tracking-[-0.05em] text-white sm:text-5xl lg:text-6xl">
                Canada&rsquo;s Fair Ride Network
              </h1>
              <p className="mt-6 max-w-xl text-xl font-semibold leading-8 text-slate-100 sm:text-2xl">
                Fair pay for drivers. Fair pricing for riders. No surge pricing. Ever.
              </p>
              <p className="mt-6 max-w-2xl text-base leading-7 text-slate-200 sm:text-lg">
                MapleRides is a Canadian rides platform built to give drivers more control and give riders a more transparent
                experience. Drivers set their own prices. MapleRides takes a small flat fee. Payments are processed securely
                through Stripe.
              </p>
              <div className="mt-8 md:hidden">
                <CtaRow light />
              </div>
              <div className="mt-8 hidden md:block">
                <CtaRow light />
              </div>
              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[1.35rem] border border-white/10 bg-white/10 px-4 py-4 backdrop-blur">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">Driver first</p>
                  <p className="mt-2 text-sm text-white">Drivers keep more and control pricing.</p>
                </div>
                <div className="rounded-[1.35rem] border border-white/10 bg-white/10 px-4 py-4 backdrop-blur">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">Rider friendly</p>
                  <p className="mt-2 text-sm text-white">Fair totals without surprise spikes.</p>
                </div>
                <div className="rounded-[1.35rem] border border-white/10 bg-white/10 px-4 py-4 backdrop-blur">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">Stripe secure</p>
                  <p className="mt-2 text-sm text-white">Modern payments and reliable checkout.</p>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 translate-x-4 translate-y-4 rounded-[2rem] bg-black/20 blur-2xl" aria-hidden="true" />
              <div className="relative rounded-[2rem] border border-white/20 bg-white/95 p-6 text-slate-950 shadow-[0_30px_80px_rgba(2,6,23,0.28)] backdrop-blur sm:p-7">
                <p className="text-sm font-semibold uppercase tracking-[0.28em] text-red-600">Why MapleRides</p>
                <h2 className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-3xl">
                  A cleaner marketplace for every ride.
                </h2>
                <p className="mt-4 text-base leading-7 text-slate-600">
                  Fairness is built into the model: no surge pricing, driver-set pricing, a simple flat fee, and secure
                  payments.
                </p>
                <div className="mt-6 grid gap-3">
                  {heroHighlights.map((item) => (
                    <div key={item.title} className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                          <item.icon aria-hidden="true" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-950">{item.title}</h3>
                          <p className="mt-1 text-sm leading-6 text-slate-600">{item.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 rounded-[1.5rem] bg-slate-950 px-5 py-5 text-white">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">Payments</p>
                  <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="max-w-sm text-sm leading-6 text-slate-200">Secure payments powered by Stripe.</p>
                    <Image
                      src="/stripe-secure-badge.png"
                      alt="Stripe secure payments"
                      width={347}
                      height={83}
                      className="h-auto w-[124px]"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SectionShell id="why-maplerides" className="relative py-20 sm:py-24">
        <SectionIntro
          eyebrow="Why MapleRides"
          title="A Better Deal for Drivers and Riders"
          description="Built for a cleaner, more practical ride marketplace with clear pricing, better driver economics, and secure payments."
          centered
        />
        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {whyMapleRidesCards.map((item) => (
            <FeatureCard key={item.title} icon={item.icon} title={item.title} description={item.description} />
          ))}
        </div>
      </SectionShell>

      <SectionShell id="drivers" className="bg-white py-20 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)] lg:items-center">
          <SectionIntro
            eyebrow="Driver First"
            title="Fair Pay For Drivers"
            description="Drivers should not lose a large percentage of every ride to platform commissions. MapleRides uses a simple flat fee approach so drivers keep more of what they earn."
          />
          <div className="rounded-[2rem] border border-slate-200 bg-[#fff7f6] p-6 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-7">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-red-600">Driver essentials</p>
            <div className="mt-5">
              <Checklist items={driverFeatures} />
            </div>
            <p className="mt-5 text-sm leading-6 text-slate-500">Payment processing fees may apply through Stripe.</p>
          </div>
        </div>
      </SectionShell>

      <SectionShell id="riders" className="py-20 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[minmax(320px,0.92fr)_minmax(0,1fr)] lg:items-center">
          <div className="order-2 rounded-[2rem] border border-slate-200 bg-slate-950 p-6 text-white shadow-[0_28px_80px_rgba(15,23,42,0.2)] sm:p-7 lg:order-1">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-red-300">Rider benefits</p>
            <div className="mt-5">
              <Checklist items={riderFeatures} />
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <SectionIntro
              eyebrow="Rider Friendly"
              title="Fair Pricing For Riders"
              description="Riders deserve clear and reasonable pricing without unpredictable spikes. MapleRides gives customers a better experience with transparent pricing and direct access to drivers."
            />
          </div>
        </div>
      </SectionShell>

      <SectionShell id="coverage" className="bg-slate-950 py-20 text-white sm:py-24">
        <SectionIntro
          eyebrow="Coverage"
          title="Built for All of Canada"
          description="MapleRides is designed to operate in every kind of Canadian community, from major cities to small towns. Our goal is to create a ride network that works wherever drivers and riders need it."
          centered
          dark
        />
        <p className="mx-auto mt-5 max-w-3xl text-center text-base leading-7 text-slate-200">
          Big city or small town, if there is a driver, there can be a ride.
        </p>
        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {coverageCards.map((item) => (
            <FeatureCard key={item.title} icon={item.icon} title={item.title} description={item.description} dark />
          ))}
        </div>
      </SectionShell>

      <SectionShell id="trust" className="bg-white py-20 sm:py-24">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <SectionIntro
            eyebrow="Trust, Safety, and Payments"
            title="Secure, Simple, Reliable"
            description="MapleRides focuses on transparent payments, clear transactions, and a modern platform experience that feels dependable from the first booking onward."
          />
          <div className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 px-4 py-3">
            <Image
              src="/stripe-secure-badge.png"
              alt="Stripe secure payments"
              width={347}
              height={83}
              className="h-auto w-[132px]"
            />
          </div>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {trustFeatures.map((item) => (
            <FeatureCard key={item.title} icon={item.icon} title={item.title} description={item.description} />
          ))}
        </div>
      </SectionShell>

      <SectionShell id="final-cta" className="py-6 pb-24 sm:pb-28">
        <div className="overflow-hidden rounded-[2.25rem] bg-[linear-gradient(135deg,#d9222a_0%,#991b1b_55%,#111827_100%)] px-6 py-10 text-white shadow-[0_34px_90px_rgba(127,29,29,0.3)] sm:px-10 sm:py-14">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.32em] text-red-100/80">Ready when you are</p>
            <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] sm:text-5xl">Ready to Ride or Start Driving?</h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-red-50 sm:text-lg">
              Join MapleRides and be part of a fairer Canadian ride network.
            </p>
            <div className="mt-8">
              <CtaRow final />
            </div>
          </div>
        </div>
      </SectionShell>
    </main>
  )
}
