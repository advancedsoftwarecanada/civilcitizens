import type { ReactNode } from 'react'
import type { IconType } from 'react-icons'
import Image from 'next/image'
import Link from 'next/link'
import AuthAwareCtaButton from './AuthAwareCtaButton'
import { AddressDirectionsMap } from './map/AddressDirectionsMap'
import {
  FaArrowRight,
  FaCarSide,
  FaCheckCircle,
  FaCreditCard,
  FaDollarSign,
  FaLeaf,
  FaReceipt,
  FaShieldAlt,
  FaStore,
  FaUsers,
} from 'react-icons/fa'

const heroHighlights = [
  {
    icon: FaDollarSign,
    title: 'Drivers set their own prices',
    description: 'Book rides with transparent fares. Drive with more control. No surge pricing. Small flat platform fee.',
  },
  {
    icon: FaLeaf,
    title: 'A simpler, fairer model',
    description:
      'MapleRides is a Canadian rideshare platform built around a simpler, fairer model. Riders can book trips with clear pricing, while drivers keep more control by setting their own rates. MapleRides earns a small flat fee per ride, with payments handled through a secure online checkout flow.',
  },
]

const driverFeatures = [
  'Small flat fee per ride',
  'Set your own prices',
  'No forced surge pricing',
  'No MapleRides withdrawal fee',
  'Secure payouts',
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
    title: 'Secure online payments',
    description: 'A dependable checkout experience built for secure online payments.',
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

const landingMapOrigin = {
  latitude: 49.2827,
  longitude: -123.1207,
  label: 'Vancouver',
}

const landingMapDestination = {
  latitude: 44.6488,
  longitude: -63.5752,
  label: 'Halifax',
}

const landingMapWaypoints = [
  {
    latitude: 51.0447,
    longitude: -114.0719,
    label: 'Calgary',
  },
  {
    latitude: 49.8951,
    longitude: -97.1384,
    label: 'Winnipeg',
  },
  {
    latitude: 43.6532,
    longitude: -79.3832,
    label: 'Toronto',
    kind: 'pickup' as const,
  },
  {
    latitude: 45.5017,
    longitude: -73.5673,
    label: 'Montreal',
  },
]

const landingMapRouteCoordinates: Array<[number, number]> = [
  [-123.1207, 49.2827],
  [-121.9, 50.4],
  [-118.6, 51.0],
  [-114.0719, 51.0447],
  [-110.2, 50.9],
  [-104.6189, 50.4452],
  [-97.1384, 49.8951],
  [-90.2, 48.4],
  [-84.3, 46.5],
  [-79.3832, 43.6532],
  [-76.1, 44.1],
  [-73.5673, 45.5017],
  [-68.5, 46.2],
  [-63.5752, 44.6488],
]

const landingMapHighlight =
  'Get a ride in populated urban area, and even in small rural communities. We charge a small flat rate fee, allowing drivers to keep way more profit, and operate in every city in Canada.'

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

function HeroActions({ final = false, lightTheme = false }: { final?: boolean; lightTheme?: boolean }) {
  const secondaryLabel = final ? 'Become a Driver' : 'Drive with MapleRides'

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <AuthAwareCtaButton
        className={`inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition ${
          lightTheme
            ? 'bg-[var(--cc-primary)] text-white shadow-[0_18px_38px_rgba(220,38,38,0.22)] hover:bg-red-700'
            : 'bg-[var(--cc-primary)] text-white shadow-[0_18px_38px_rgba(220,38,38,0.24)] hover:bg-red-700'
        }`}
      >
        <FaCarSide className="h-3.5 w-3.5" />
        Book a Ride
      </AuthAwareCtaButton>
      <AuthAwareCtaButton
        className={`inline-flex items-center justify-center gap-2 rounded-full border px-6 py-3 text-sm font-semibold transition ${
          lightTheme
            ? 'border-emerald-600 bg-emerald-600 text-white shadow-[0_18px_38px_rgba(5,150,105,0.22)] hover:bg-emerald-700 hover:border-emerald-700'
            : 'border-emerald-500 bg-emerald-500 text-white shadow-[0_18px_38px_rgba(5,150,105,0.24)] hover:bg-emerald-600 hover:border-emerald-600'
        }`}
      >
        <FaDollarSign className="h-3.5 w-3.5" />
        {secondaryLabel}
      </AuthAwareCtaButton>
    </div>
  )
}

export default function MapleRidesLandingPage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#fff6f3_30%,#ffffff_100%)] text-slate-950">
      <SectionShell className="relative overflow-hidden py-6 sm:py-8">
        <div className="absolute inset-0 bg-[url('/Toronto-Wallpaper.jpg')] bg-cover bg-center bg-fixed" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(15,23,42,0.72)_0%,rgba(15,23,42,0.42)_42%,rgba(225,39,28,0.22)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(248,113,113,0.26),transparent_30%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.16)_0%,rgba(15,23,42,0.34)_100%)]" />
        <div className="relative">
          <div className="rounded-[1.8rem] border border-slate-200 bg-white px-4 py-3 shadow-[0_16px_36px_rgba(15,23,42,0.12)] sm:px-6">
            <div className="flex items-center justify-between gap-4">
              <Link href="/" className="inline-flex items-center gap-3" aria-label="MapleRides home">
                <Image src="/Maple-Rides.png" alt="MapleRides logo" width={164} height={52} className="h-auto w-[132px] sm:w-[164px]" priority />
              </Link>
              <div className="hidden items-center gap-6 text-sm font-semibold text-slate-700 md:flex">
                <a href="#coverage-map" className="transition hover:text-[var(--cc-primary)]">Coverage Map</a>
                <a href="#drivers" className="transition hover:text-[var(--cc-primary)]">Drivers</a>
                <a href="#riders" className="transition hover:text-[var(--cc-primary)]">Riders</a>
                <a href="#trust" className="transition hover:text-[var(--cc-primary)]">Trust</a>
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,1.08fr)_minmax(280px,0.92fr)] lg:items-start lg:gap-10">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.32em] text-red-200">Canadian owned rides platform</p>
              <h1 className="mt-5 max-w-4xl text-4xl font-black tracking-[-0.05em] text-white sm:text-6xl lg:text-7xl">
                A Canadian app for booking rides and driving for hire
              </h1>
              <p className="mt-4 max-w-2xl text-lg font-semibold leading-8 text-red-200 sm:text-[1.35rem]">
                🍁 A Canadian alternative to Uber and Lyft with no surge pricing.
              </p>
              <div className="mt-8">
                <HeroActions />
              </div>
            </div>

            <div className="relative">
              <div className="rounded-[2.4rem] border border-white/70 bg-white/72 p-5 shadow-[0_28px_80px_rgba(225,39,28,0.18)] backdrop-blur">
                <div className="grid gap-4">
                  {heroHighlights.map((item) => (
                    <FeatureCard key={item.title} {...item} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </SectionShell>

      <SectionShell id="coverage-map" className="relative py-20 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-center">
          <div>
            <SectionHeading
              eyebrow="Coverage Map"
              title="Ride Everywhere In Canada"
              description="Peer to Peer ride connections lets you get a ride anywhere in Canada"
            />
            <div className="mt-8">
              <div className="rounded-[1.6rem] border border-slate-200 bg-white px-5 py-4 text-sm leading-6 text-slate-700 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
                {landingMapHighlight}
              </div>
            </div>
          </div>
          <div className="rounded-[2rem] border border-slate-200 bg-white p-3 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-4">
            <AddressDirectionsMap
              origin={landingMapOrigin}
              destination={landingMapDestination}
              waypoints={landingMapWaypoints}
              routeCoordinates={landingMapRouteCoordinates}
              pulseRouteLine
              idleCameraMode="fit-once-per-key"
              idleViewportKey="maplerides-canada-coverage"
            />
            <div className="mt-4 flex flex-wrap gap-2 px-1 pb-1">
              {['Vancouver', 'Calgary', 'Winnipeg', 'Toronto', 'Montreal', 'Halifax'].map((city) => (
                <span key={city} className="inline-flex items-center rounded-full bg-red-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-red-700">
                  {city}
                </span>
              ))}
            </div>
          </div>
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
