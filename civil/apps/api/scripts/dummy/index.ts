import { DUMMY_PASSWORD, ensureDummyBaseData } from './shared.js'
import { seedDummyEvents } from './events.js'
import { seedDummyPosts } from './posts.js'

export async function runDummySeed() {
  const context = await ensureDummyBaseData()
  const eventSummary = await seedDummyEvents(context)
  const postSummary = await seedDummyPosts(context)

  console.log(`Seeded ${context.users.length} dummy users and ${context.organizations.length} Ontario organizations.`)
  console.log(`Shared dummy password: ${DUMMY_PASSWORD}`)
  console.log(`Demo login: demo@civil.local / ${DUMMY_PASSWORD}`)
  console.log(`Event assets: ${context.eventImageUrls.length}, people assets: ${context.peopleImageUrls.length}`)
  console.log(`Events created: ${eventSummary.eventCount}, RSVPs created: ${eventSummary.rsvpCount}`)
  console.log(`Posts created: ${postSummary.postCount}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDummySeed().catch((error) => {
    console.error('Failed to seed dummy data:', error)
    process.exit(1)
  })
}