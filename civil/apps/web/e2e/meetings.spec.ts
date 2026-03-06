import { expect, test } from '@playwright/test'
import { authenticatePage, createMeeting, createTestOrganization } from './helpers/civilApi'

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test.describe('Organization meetings', () => {
  test('shows published rooms and prioritizes in-session meetings', async ({ page, request }) => {
    const org = await createTestOrganization(request)
    const now = Date.now()

    const inSession = await createMeeting(request, {
      token: org.token,
      province: org.province,
      municipality: org.municipality,
      organizationSlug: org.organizationSlug,
      input: {
        title: 'PW In Session Meeting',
        status: 'ACTIVE',
        startsAt: new Date(now - 5 * 60_000).toISOString(),
        endsAt: new Date(now + 55 * 60_000).toISOString(),
      },
    })

    const unscheduled = await createMeeting(request, {
      token: org.token,
      province: org.province,
      municipality: org.municipality,
      organizationSlug: org.organizationSlug,
      input: {
        title: 'PW Daily Scrum Room',
        status: 'ACTIVE',
      },
    })

    const scheduled = await createMeeting(request, {
      token: org.token,
      province: org.province,
      municipality: org.municipality,
      organizationSlug: org.organizationSlug,
      input: {
        title: 'PW Future Planning Meeting',
        status: 'ACTIVE',
        startsAt: new Date(now + 2 * 60 * 60_000).toISOString(),
        endsAt: new Date(now + 3 * 60 * 60_000).toISOString(),
      },
    })

    await authenticatePage(page, org.token)
    await page.goto(org.meetingsViewPath)

    await expect(page.getByText(inSession.title)).toBeVisible()
    await expect(page.getByText(unscheduled.title)).toBeVisible()
    await expect(page.getByText(scheduled.title)).toBeVisible()

    const firstCard = page.locator('[data-testid="meeting-card"]').first()
    await expect(firstCard).toHaveAttribute('data-meeting-id', inSession.id)
    await expect(firstCard.getByTestId('meeting-in-session')).toBeVisible()
  })

  test('draft editor keeps fixed controls and supports save + delete', async ({ page, request }) => {
    const org = await createTestOrganization(request)

    const draft = await createMeeting(request, {
      token: org.token,
      province: org.province,
      municipality: org.municipality,
      organizationSlug: org.organizationSlug,
      input: {
        title: 'PW Draft Meeting',
        status: 'ARCHIVED',
      },
    })

    await authenticatePage(page, org.token)
    await page.goto(`${org.meetingsManagePath}/${encodeURIComponent(draft.id)}`)

    await expect(page.getByTestId('meeting-status-select')).toHaveValue('ARCHIVED')
    await expect(page.getByTestId('meeting-max-participants-input')).toHaveValue('10')
    await expect(page.getByTestId('meeting-max-participants-input')).toBeDisabled()
    await expect(page.getByTestId('meeting-visibility-select').locator('option')).toContainText(['Public', 'Organization Only'])

    const manualClass = await page.getByTestId('meeting-manual-admit-card').getAttribute('class')
    const passwordClass = await page.getByTestId('meeting-password-card').getAttribute('class')
    expect(manualClass).toBe(passwordClass)

    const updatedTitle = 'PW Draft Meeting Updated'
    await page.getByTestId('meeting-title-input').fill(updatedTitle)
    await page.getByTestId('meeting-status-select').selectOption('ACTIVE')
    await page.getByTestId('meeting-save-button').click()
    await expect(page.getByTestId('meeting-status-select')).toHaveValue('ACTIVE')

    await page.goto(org.meetingsManagePath)
    await expect(page.getByText(updatedTitle)).toBeVisible()

    await page.goto(`${org.meetingsManagePath}/${encodeURIComponent(draft.id)}`)
    await page.getByTestId('meeting-delete-button').click()
    await expect(page.getByTestId('meeting-delete-modal')).toBeVisible()
    await page.getByTestId('meeting-delete-confirm-button').click()

    await expect(page).toHaveURL(new RegExp(`${escapeRegex(org.meetingsManagePath)}$`))
    await expect(page.getByText(updatedTitle)).toHaveCount(0)
  })
})

