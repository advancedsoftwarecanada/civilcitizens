import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'

import {
  DUMMY_EVENT_PREFIX,
  DUMMY_RSVP_PREFIX,
  ensureDummyBaseData,
  mergeOrganizationMetadata,
  readOrganizationSystemRaw,
  type DummySeedContext,
} from './shared.js'

const EVENT_CATEGORIES = [
  'Community',
  'Government',
  'Family & Education',
  'Food & Drink',
  'Sports & Fitness',
  'Science & Tech',
  'Travel & Outdoor',
  'Other',
] as const

const EVENT_TITLE_PREFIXES = [
  'Town Hall',
  'Volunteer Night',
  'Open House',
  'Planning Session',
  'Neighbour Meetup',
  'Workshop',
] as const

function buildEventDate(orgIndex: number, eventIndex: number) {
  const base = new Date()
  base.setHours(18, 0, 0, 0)
  base.setDate(base.getDate() + orgIndex + eventIndex * 4)
  return base
}

export async function seedDummyEvents(context?: DummySeedContext) {
  const seedContext = context ?? (await ensureDummyBaseData())
  const userIds = new Set(seedContext.users.map((user) => user.id))
  let eventCount = 0
  let rsvpCount = 0

  for (let orgIndex = 0; orgIndex < seedContext.organizations.length; orgIndex += 1) {
    const organization = seedContext.organizations[orgIndex]
    if (!organization) continue

    const business = await prisma.business.findUnique({ where: { id: organization.id }, select: { id: true, metadata: true } })
    if (!business) continue

    const rawSystem = readOrganizationSystemRaw(business.metadata)
    const existingEvents = Array.isArray(rawSystem.events) ? (rawSystem.events as Array<Record<string, unknown>>) : []
    const existingRsvps = Array.isArray(rawSystem.eventRsvps) ? (rawSystem.eventRsvps as Array<Record<string, unknown>>) : []
    const preservedEvents = existingEvents.filter((event) => !String(event.id ?? '').startsWith(DUMMY_EVENT_PREFIX))
    const preservedRsvps = existingRsvps.filter(
      (row) => !String(row.id ?? '').startsWith(DUMMY_RSVP_PREFIX) && !String(row.eventId ?? '').startsWith(DUMMY_EVENT_PREFIX),
    )

    const owner = seedContext.users.find((user) => user.id === organization.ownerId) ?? seedContext.users[orgIndex % seedContext.users.length]
    if (!owner) continue

    const nextEvents: Array<Record<string, unknown>> = []
    const nextRsvps: Array<Record<string, unknown>> = []

    for (let eventIndex = 0; eventIndex < 3; eventIndex += 1) {
      const startsAt = buildEventDate(orgIndex, eventIndex)
      const endsAt = new Date(startsAt)
      endsAt.setHours(endsAt.getHours() + 3)
      const eventId = `${DUMMY_EVENT_PREFIX}${orgIndex + 1}_${eventIndex + 1}`
      const photoOffset = orgIndex * 3 + eventIndex
      const primaryPhotoUrl = seedContext.eventImageUrls[photoOffset % seedContext.eventImageUrls.length] ?? null
      const galleryPhotoUrls = [
        seedContext.eventImageUrls[(photoOffset + 1) % seedContext.eventImageUrls.length] ?? null,
        seedContext.eventImageUrls[(photoOffset + 2) % seedContext.eventImageUrls.length] ?? null,
      ].filter((value): value is string => Boolean(value))

      nextEvents.push({
        id: eventId,
        title: `${EVENT_TITLE_PREFIXES[(orgIndex + eventIndex) % EVENT_TITLE_PREFIXES.length] ?? 'Event'}: ${organization.name}`,
        description: `${organization.name} is hosting a seeded Ontario dummy event for calendar, feed, and RSVP testing.`,
        category: EVENT_CATEGORIES[(orgIndex + eventIndex) % EVENT_CATEGORIES.length] ?? 'Other',
        access: 'PUBLIC',
        eligibleRankIds: [],
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        capacity: 120,
        paid: false,
        priceCents: null,
        currency: 'CAD',
        guestSpeakers: [owner.name],
        guestSpeakerInvites: [],
        sponsors: [],
        sponsorInvites: [],
        fees: [],
        primaryPhotoUrl,
        galleryPhotoUrls,
        agenda: [],
        attachments: [],
        status: 'PUBLISHED',
        createdAt: startsAt.toISOString(),
        updatedAt: startsAt.toISOString(),
      })

      const attendees = [
        owner,
        seedContext.users[(orgIndex + eventIndex + 1) % seedContext.users.length],
        seedContext.users[(orgIndex + eventIndex + 7) % seedContext.users.length],
        seedContext.users[(orgIndex + eventIndex + 14) % seedContext.users.length],
        seedContext.users[(orgIndex + eventIndex + 21) % seedContext.users.length],
      ].filter((user): user is (typeof seedContext.users)[number] => Boolean(user))

      attendees.forEach((user, attendeeIndex) => {
        nextRsvps.push({
          id: `${DUMMY_RSVP_PREFIX}${orgIndex + 1}_${eventIndex + 1}_${attendeeIndex + 1}`,
          eventId,
          userId: user.id,
          status: attendeeIndex === attendees.length - 1 ? 'INTERESTED' : 'GOING',
          ticketId: null,
          ticketLabel: null,
          amountCents: null,
          message: null,
          createdAt: startsAt.toISOString(),
          updatedAt: startsAt.toISOString(),
        })
      })
    }

    const nextSystem = {
      ...rawSystem,
      version: 1,
      joinMode: rawSystem.joinMode ?? 'PUBLIC',
      events: [...preservedEvents, ...nextEvents],
      eventRsvps: [...preservedRsvps.filter((row) => userIds.has(String(row.userId ?? '')) === false || String(row.eventId ?? '').startsWith(DUMMY_EVENT_PREFIX) === false), ...nextRsvps],
    }

    await prisma.business.update({
      where: { id: business.id },
      data: { metadata: mergeOrganizationMetadata(business.metadata, nextSystem as Record<string, unknown>) },
      select: { id: true },
    })

    eventCount += nextEvents.length
    rsvpCount += nextRsvps.length
  }

  console.log(`Seeded ${eventCount} dummy Ontario events and ${rsvpCount} dummy RSVPs.`)
  return { eventCount, rsvpCount }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDummyEvents().catch((error) => {
    console.error('Failed to seed dummy events:', error)
    process.exit(1)
  })
}