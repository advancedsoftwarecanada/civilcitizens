#!/usr/bin/env node

const API_BASE = process.env.CIVIL_SMOKE_API_BASE || 'http://127.0.0.1:3012'
const WEB_BASE = process.env.CIVIL_SMOKE_WEB_BASE || 'http://127.0.0.1:33101'
const PROVINCE = process.env.CIVIL_SMOKE_PROVINCE || 'on'
const MUNICIPALITY = process.env.CIVIL_SMOKE_MUNICIPALITY || 'york-durham'

function nowIso() {
  return new Date().toISOString()
}

function fail(message, details) {
  const payload = details ? `\n${JSON.stringify(details, null, 2)}` : ''
  throw new Error(`${message}${payload}`)
}

async function request(path, init = {}) {
  const url = `${API_BASE}${path}`
  const response = await fetch(url, init)
  let json = null
  let text = null
  try {
    json = await response.clone().json()
  } catch {
    try {
      text = await response.text()
    } catch {
      text = null
    }
  }
  return { response, json, text, url }
}

async function requestWeb(path, init = {}) {
  const url = `${WEB_BASE}${path}`
  const response = await fetch(url, init)
  const text = await response.text()
  return { response, text, url }
}

function randomSuffix() {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')}`
}

async function main() {
  const suffix = randomSuffix()
  const email = `meetings-smoke-${suffix}@example.com`
  const password = `SmokePass!${Math.floor(Math.random() * 100000)}`
  const firstName = 'Meetings'
  const lastName = `Smoke${suffix.slice(-6)}`
  const orgName = `Meetings Smoke ${suffix}`
  const orgSlug = `meetings-smoke-${suffix}`
  const meetingTitle = `Smoke Room ${suffix}`
  const startDate = new Date(Date.now() - 60_000).toISOString()
  const endDate = new Date(Date.now() + 3_600_000).toISOString()

  console.log(`[smoke] API base: ${API_BASE}`)
  console.log(`[smoke] WEB base: ${WEB_BASE}`)
  console.log(`[smoke] Registering user ${email}`)

  const register = await request('/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, firstName, lastName, password, acceptTerms: true }),
  })
  if (!register.response.ok || !register.json?.token || !register.json?.user?.id) {
    fail('register_failed', { status: register.response.status, body: register.json ?? register.text })
  }
  const token = register.json.token
  const userId = register.json.user.id
  console.log(`[smoke] Registered user ${userId}`)

  console.log(`[smoke] Creating org ${orgSlug}`)
  const createOrg = await request(`/communities/${encodeURIComponent(PROVINCE)}/${encodeURIComponent(MUNICIPALITY)}/orgs`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: orgName,
      slug: orgSlug,
      type: 'COMMUNITY_GROUP',
      description: 'Automated meetings smoke org',
    }),
  })
  if (!createOrg.response.ok || !createOrg.json?.org?.slug) {
    fail('org_create_failed', { status: createOrg.response.status, body: createOrg.json ?? createOrg.text })
  }
  const createdOrgSlug = createOrg.json.org.slug
  console.log(`[smoke] Created org ${createdOrgSlug}`)

  const meetingsListInitial = await request(
    `/communities/${encodeURIComponent(PROVINCE)}/${encodeURIComponent(MUNICIPALITY)}/orgs/${encodeURIComponent(createdOrgSlug)}/meetings`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  )
  if (!meetingsListInitial.response.ok || !Array.isArray(meetingsListInitial.json?.items)) {
    fail('meetings_list_initial_failed', {
      status: meetingsListInitial.response.status,
      body: meetingsListInitial.json ?? meetingsListInitial.text,
    })
  }
  console.log(`[smoke] Initial meetings count: ${meetingsListInitial.json.items.length}`)

  console.log('[smoke] Creating meeting draft')
  const createMeeting = await request(
    `/communities/${encodeURIComponent(PROVINCE)}/${encodeURIComponent(MUNICIPALITY)}/orgs/${encodeURIComponent(createdOrgSlug)}/governance/meetings`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: meetingTitle,
        description: 'Automated smoke draft',
        visibility: 'PUBLIC',
        requiresPassword: false,
        password: null,
        requiresManualAdmit: false,
        maxParticipants: 10,
        schedule: {
          startsAt: startDate,
          endsAt: endDate,
        },
        assignedMemberUserIds: [userId],
        status: 'ARCHIVED',
      }),
    },
  )
  if (!createMeeting.response.ok || !createMeeting.json?.meeting?.id) {
    fail('meeting_create_failed', { status: createMeeting.response.status, body: createMeeting.json ?? createMeeting.text })
  }
  const meetingId = createMeeting.json.meeting.id
  console.log(`[smoke] Created draft meeting ${meetingId}`)

  console.log('[smoke] Saving meeting as published')
  const updateMeeting = await request(
    `/communities/${encodeURIComponent(PROVINCE)}/${encodeURIComponent(MUNICIPALITY)}/orgs/${encodeURIComponent(
      createdOrgSlug,
    )}/governance/meetings/${encodeURIComponent(meetingId)}`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: `${meetingTitle} Published`,
        description: 'Automated smoke published',
        visibility: 'PUBLIC',
        requiresPassword: false,
        requiresManualAdmit: false,
        maxParticipants: 10,
        schedule: {
          startsAt: startDate,
          endsAt: endDate,
        },
        assignedMemberUserIds: [userId],
        status: 'ACTIVE',
      }),
    },
  )
  if (!updateMeeting.response.ok || updateMeeting.json?.meeting?.status !== 'ACTIVE') {
    fail('meeting_update_failed', { status: updateMeeting.response.status, body: updateMeeting.json ?? updateMeeting.text })
  }

  const meetingsListManage = await request(
    `/communities/${encodeURIComponent(PROVINCE)}/${encodeURIComponent(MUNICIPALITY)}/orgs/${encodeURIComponent(
      createdOrgSlug,
    )}/meetings?includeArchived=1`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  )
  if (!meetingsListManage.response.ok || !Array.isArray(meetingsListManage.json?.items)) {
    fail('meetings_manage_list_failed', {
      status: meetingsListManage.response.status,
      body: meetingsListManage.json ?? meetingsListManage.text,
    })
  }
  const listedManage = meetingsListManage.json.items.some((item) => item?.id === meetingId)
  if (!listedManage) {
    fail('meeting_missing_from_manage_list', { meetingId, items: meetingsListManage.json.items })
  }

  const meetingsListPublic = await request(
    `/communities/${encodeURIComponent(PROVINCE)}/${encodeURIComponent(MUNICIPALITY)}/orgs/${encodeURIComponent(createdOrgSlug)}/meetings`,
  )
  if (!meetingsListPublic.response.ok || !Array.isArray(meetingsListPublic.json?.items)) {
    fail('meetings_public_list_failed', {
      status: meetingsListPublic.response.status,
      body: meetingsListPublic.json ?? meetingsListPublic.text,
    })
  }
  const listedPublic = meetingsListPublic.json.items.some((item) => item?.id === meetingId)
  if (!listedPublic) {
    fail('meeting_missing_from_public_list', { meetingId, items: meetingsListPublic.json.items })
  }
  console.log('[smoke] Meeting appears in manage/public list')

  console.log('[smoke] Verifying meetings page renders in web UI')
  const meetingsPage = await requestWeb(
    `/com/${encodeURIComponent(PROVINCE)}/${encodeURIComponent(MUNICIPALITY)}/orgs/${encodeURIComponent(createdOrgSlug)}/meetings`,
  )
  if (!meetingsPage.response.ok) {
    fail('meetings_web_page_failed', { status: meetingsPage.response.status, url: meetingsPage.url })
  }
  const hasMeetingsTitle = meetingsPage.text.includes('Meetings')
  const hasCalendarLabel = meetingsPage.text.includes('Calendar')
  if (!hasMeetingsTitle || !hasCalendarLabel) {
    fail('meetings_web_page_missing_expected_ui', {
      status: meetingsPage.response.status,
      hasMeetingsTitle,
      hasCalendarLabel,
      url: meetingsPage.url,
    })
  }
  console.log('[smoke] Web meetings page renders expected shell')

  const meetingDetail = await request(
    `/communities/${encodeURIComponent(PROVINCE)}/${encodeURIComponent(MUNICIPALITY)}/orgs/${encodeURIComponent(
      createdOrgSlug,
    )}/meetings/${encodeURIComponent(meetingId)}`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  )
  if (!meetingDetail.response.ok || !meetingDetail.json?.meeting) {
    fail('meeting_detail_failed', { status: meetingDetail.response.status, body: meetingDetail.json ?? meetingDetail.text })
  }

  console.log('[smoke] Joining meeting room')
  const joinMeeting = await request(
    `/communities/${encodeURIComponent(PROVINCE)}/${encodeURIComponent(MUNICIPALITY)}/orgs/${encodeURIComponent(
      createdOrgSlug,
    )}/governance/meetings/${encodeURIComponent(meetingId)}/join`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ password: null }),
    },
  )
  if (!joinMeeting.response.ok || !joinMeeting.json?.meeting) {
    fail('meeting_join_failed', { status: joinMeeting.response.status, body: joinMeeting.json ?? joinMeeting.text })
  }

  const threadId = joinMeeting.json.threadId || joinMeeting.json.meeting.threadId || null
  if (!threadId) {
    fail('meeting_join_missing_thread', { body: joinMeeting.json })
  }
  console.log(`[smoke] Join state=${joinMeeting.json.state || 'joined'} thread=${threadId}`)

  console.log('[smoke] Requesting RTC session (config dependent)')
  const rtcSession = await request(
    `/communities/${encodeURIComponent(PROVINCE)}/${encodeURIComponent(MUNICIPALITY)}/orgs/${encodeURIComponent(
      createdOrgSlug,
    )}/meetings/${encodeURIComponent(meetingId)}/rtc/session`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        displayName: null,
        deviceId: `smoke-${suffix}`,
        capabilities: { audio: true, video: true },
      }),
    },
  )
  if (!rtcSession.response.ok) {
    const rtcError = typeof rtcSession.json?.error === 'string' ? rtcSession.json.error : null
    const acceptable = rtcError === 'meeting_rtc_not_configured'
    if (!acceptable) {
      fail('meeting_rtc_session_failed', { status: rtcSession.response.status, body: rtcSession.json ?? rtcSession.text })
    }
    console.log(`[smoke] RTC not configured (${rtcError})`)
  } else {
    console.log('[smoke] RTC session request succeeded')
  }

  console.log(`[smoke] PASS at ${nowIso()}`)
}

main().catch((err) => {
  console.error(`[smoke] FAIL: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
