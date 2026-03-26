/* eslint-disable no-console */
import { prisma } from '@civil/db'
import { backfillCauseRecordsFromDrafts, loadMissingPublishedCauseDraftRows } from '../src/causes.js'

async function main() {
  const missingRows = await loadMissingPublishedCauseDraftRows()
  if (!missingRows.length) {
    console.log('No published Cause drafts are missing civil_cause rows.')
    return
  }

  const postIds = missingRows.flatMap((row) => (row.published_post_id ? [row.published_post_id] : []))
  console.log(`Found ${postIds.length} published Cause posts without civil_cause rows.`)

  const result = await backfillCauseRecordsFromDrafts(postIds)
  const repairedUnique = Array.from(new Set(result.repairedPostIds))
  console.log(`Repaired ${repairedUnique.length} Cause records.`)

  for (const row of missingRows) {
    if (!row.published_post_id) continue
    const repaired = repairedUnique.includes(row.published_post_id)
    console.log(`${repaired ? 'repaired' : 'skipped'} post=${row.published_post_id} draft=${row.id} title=${JSON.stringify(row.title)}`)
  }
}

main()
  .catch((error) => {
    console.error('Cause repair failed', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })