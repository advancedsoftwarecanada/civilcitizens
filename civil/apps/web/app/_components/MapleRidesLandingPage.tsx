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

const bookRideHref = '/ride'
const driveWithMapleHref = '/drive/onboarding'

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
    title: 'Designed for all kinds of Canadian communities',
    description: 'Flexible local supply helps communities grow their own ride coverage.',
  },
  {
    icon: FaLeaf,
    title: 'Built with a local-first mindset',
    description: 'A Canadian platform with a simpler and more practical operating model.',
  },
  {
    icon: FaStore,
    title: 'A cleaner marketplace model',
    description: 'Big city or small town, if there is a driver, there can be a ride.',
  },
]

function SectionShell({
  children,
  className = '',
  id,
}: {
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <section id={id} className={className}>
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 lg:px-10">{children}</div>
    </section>
  )
}

function SectionHeading({
  eyebrow,
  title,
  description,
  light = false,
}: {
  eyebrow: string
  title: string
  description: string
  light?: boolean
}) {
  return (
    <div className="max-w-3xl">
      <p className={`text-sm font-semibold uppercase tracking-[0.28em] ${light ? 'text-red-200' : 'text-red-600'}`}>{eyebrow}</p>
      <h2 className={`mt-4 text-3xl font-black tracking-[-0.04em] sm:text-5xl ${light ? 'text-white' : 'text-slate-950'}`}>{title}</h2>
      <p className={`mt-4 text-base leading-7 sm:text-lg ${light ? 'text-red-50/88' : 'text-slate-600'}`}>{description}</p>
    </div>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  light = false,
}: {
  icon: IconType
  title: string
  description: string
  light?: boolean
}) {
  return (
    <article className={`rounded-[2rem] border p-6 shadow-[0_22px_60px_rgba(15,23,42,0.08)] ${light ? 'border-white/15 bg-white/10 backdrop-blur' : 'border-slate-200 bg-white'}`}>
      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${light ? 'bg-white/15 text-white' : 'bg-red-50 text-red-600'}`}>
        <Icon className="h-5 w-5" />
      </div>
      <h3 className={`mt-5 text-xl font-semibold ${light ? 'text-white' : 'text-slate-950'}`}>{title}</h3>
      <p className={`mt-3 text-sm leading-6 ${light ? 'text-red-50/80' : 'text-slate-600'}`}>{description}</p>
    </article>
  )
}

function Checklist({ items, light = false }: { items: string[]; light?: boolean }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item} className={`flex items-start gap-3 text-sm leading-6 ${light ? 'text-red-50/90' : 'text-slate-700'}`}>
          <span className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full ${light ? 'bg-white/15 text-white' : 'bg-emerald-100 text-emerald-600'}`}>
            <FaCheckCircle className="h-3.5 w-3.5" />
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function HeroActions({ final = false }: { final?: boolean }) {
  const secondaryLabel = final ? 'Become a Driver' : 'Drive with MapleRides'

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <AuthAwareCtaButton
        href={bookRideHref}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-50"
      >
        Book a Ride
        <FaArrowRight className="h-3.5 w-3.5" />
      </AuthAwareCtaButton>
      <AuthAwareCtaButton
        href={driveWithMapleHref}
        className="inline-flex items-center justify-center gap-2 rounded-full border border-white/35 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
      >
        {secondaryLabel}
      </AuthAwareCtaButton>
    </div>
  )
}

export default function MapleRidesLandingPage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#fff6f3_30%,#ffffff_100%)] text-slate-950">
      <SectionShell className="relative overflow-hidden bg-[radial-gradient(circle_at_top_left,#ff7b66_0%,#e1271c_45%,#7a140f_100%)] py-8 text-white sm:py-10">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_48%,rgba(255,255,255,0.03)_70%,transparent_100%)]" />
        <div className="relative">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="inline-flex items-center gap-3" aria-label="MapleRides home">
              <Image src="/Maple-Rides.png" alt="MapleRides logo" width={164} height={52} className="h-auto w-[132px] sm:w-[164px]" priority />
            </Link>
            <div className="hidden items-center gap-5 text-sm font-medium text-red-50/85 md:flex">
              <a href="#why-maplerides" className="transition hover:text-white">Why MapleRides</a>
              <a href="#drivers" className="transition hover:text-white">Drivers</a>
              <a href="#riders" className="transition hover:text-white">Riders</a>
              <a href="#trust" className="transition hover:text-white">Trust</a>
            </div>
          </div>

          <div className="mt-16 grid gap-12 lg:grid-cols-[minmax(0,1.08fr)_minmax(280px,0.92fr)] lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.32em] text-red-100/80">Canadian owned rides platform</p>
              <h1 className="mt-5 max-w-4xl text-4xl font-black tracking-[-0.05em] sm:text-6xl lg:text-7xl">
                Canada&rsquo;s Fair Ride Network
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-red-50/88 sm:text-xl">
                Fair pay for drivers. Fair pricing for riders. No surge pricing. Ever.
              </p>
              <p className="mt-5 max-w-2xl text-base leading-7 text-red-50/78">
                MapleRides is a Canadian rides platform built to give drivers more control and give riders a more transparent experience. Drivers set their own prices. MapleRides takes a small flat fee. Payments are processed securely through Stripe.
              </p>
              <div className="mt-8">
                <HeroActions />
              </div>
            </div>

            <div className="relative">
              <div className="rounded-[2.4rem] border border-white/15 bg-slate-950/35 p-5 shadow-[0_28px_80px_rgba(122,20,15,0.32)] backdrop-blur">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-[1.8rem] border border-white/10 bg-white/10 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">Driver first</p>
                    <p className="mt-2 text-sm text-white">Drivers keep more and control pricing.</p>
                  </div>
                  <div className="rounded-[1.8rem] border border-white/10 bg-white/10 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">Rider friendly</p>
                    <p className="mt-2 text-sm text-white">Transparent fares without surge spikes.</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-4">
                  {heroHighlights.map((item) => (
                    <FeatureCard key={item.title} {...item} light />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </SectionShell>

      <SectionShell id="why-maplerides" className="relative py-20 sm:py-24">
        <SectionHeading
          eyebrow="Why MapleRides"
          title="A Better Deal for Drivers and Riders"
          description="Built for a cleaner, more practical ride marketplace with clear pricing, better driver economics, and secure payments."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {whyMapleRidesCards.map((item) => (
            <FeatureCard key={item.title} {...item} />
          ))}
        </div>
      </SectionShell>

      <SectionShell id="drivers" className="bg-white py-20 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-start">
          <div>
            <SectionHeading
              eyebrow="Driver First"
              title="Fair Pay For Drivers"
              description="Drivers should not lose a large percentage of every ride to platform commissions. MapleRides uses a simple flat fee approach so drivers keep more of what they earn."
            />
            <div className="mt-8 rounded-[2rem] border border-slate-200 bg-slate-50 p-6">
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-red-600">Driver essentials</p>
              <div className="mt-5">
                <Checklist items={driverFeatures} />
              </div>
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {coverageCards.map((item) => (
              <FeatureCard key={item.title} {...item} />
            ))}
          </div>
        </div>
      </SectionShell>

      <SectionShell id="riders" className="py-20 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
          <div className="rounded-[2.4rem] bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] p-8 text-white shadow-[0_28px_80px_rgba(15,23,42,0.18)]">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-red-300">Rider benefits</p>
            <div className="mt-6">
              <Checklist items={riderFeatures} light />
            </div>
          </div>
          <div>
            <SectionHeading
              eyebrow="Rider Friendly"
              title="Fair Pricing For Riders"
              description="Riders deserve clear and reasonable pricing without unpredictable spikes. MapleRides gives customers a better experience with transparent pricing and direct access to drivers."
            />
            <p className="mt-6 text-base leading-7 text-slate-600">
              MapleRides is designed to operate in every kind of Canadian community, from major cities to small towns. Our goal is to create a ride network that works wherever drivers and riders need it.
            </p>
            <p className="mt-4 text-lg font-semibold text-slate-900">
              Big city or small town, if there is a driver, there can be a ride.
            </p>
          </div>
        </div>
      </SectionShell>

      <SectionShell id="trust" className="bg-white py-20 sm:py-24">
        <SectionHeading
          eyebrow="Trust & Payments"
          title="A Modern, Practical Platform"
          description="MapleRides focuses on transparent payments, clear transactions, and a modern platform experience that feels dependable from the first booking onward."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {trustFeatures.map((item) => (
            <FeatureCard key={item.title} {...item} />
          ))}
        </div>
      </SectionShell>

      <SectionShell className="py-20 sm:py-24">
        <div className="rounded-[2.8rem] bg-[linear-gradient(135deg,#e1271c_0%,#9f1f16_100%)] px-6 py-12 text-white shadow-[0_28px_80px_rgba(159,31,22,0.28)] sm:px-10">
          <p className="text-sm font-semibold uppercase tracking-[0.32em] text-red-100/85">Ready when you are</p>
          <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] sm:text-5xl">Ready to Ride or Start Driving?</h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-red-50/90">
            Join MapleRides and be part of a fairer Canadian ride network.
          </p>
          <div className="mt-8">
            <HeroActions final />
          </div>
        </div>
      </SectionShell>
    </div>
  )
}