# Milestone 3 – Community & Events

> Objective: launch the geography-first experience that replaces legacy chambers/cities, pairing local feeds with rich event tooling.

## 1. Scope Overview
- **Community Model Migration:** import StatsCan data, align postal code → community mapping, auto-enroll users.
- **Community Feed:** aggregate local posts, announcements, org updates, jobs/gigs/events with nearby bleed.
- **Events Platform:** creation, discovery, RSVP/ticketing basics, reminder notifications.
- **Moderation & Governance:** community admins, escalation flows, tooling.

## 2. Key Components
1. **Community Directory**
   - Data migration from legacy tables, slug normalization (`/com/{province}/{slug}`).
   - Postal-code resolver (plus fallback by geolocation) for auto-home-community assignment.
   - Nearby computation service referencing StatsCan geodata.
2. **Community Feed Service**
   - Composable feed sections: posts, announcements, jobs, gigs, events, org spotlights.
   - Nearby community blending (e.g., 10% injection) with tunable weights.
   - Subscription model (follow/unfollow), default follow to home community.
3. **Event Module**
   - CRUD endpoints, visibility levels (public, community-only, invite-only).
   - RSVP states, attendee caps, waitlist.
   - Ticket metadata (free/paid placeholder) with wallet integration stubbed until Milestone 6.
   - Calendar export (ICS) and reminder notifications.
4. **Role & Moderation**
   - Community admin roles: pin posts, approve announcements, remove content, invite moderators.
   - Reporting flows escalate to global staff if unresolved.
5. **Discovery Surfaces**
   - `/community` directory with search + filters (province, population).
   - Event discovery (by date, category, distance).

## 3. Deliverables Checklist
- [ ] Prisma migrations for new community/event tables + join tables (membership, roles, RSVPs).
- [ ] Data import scripts and verification reports (counts per province, missing postal codes).
- [ ] Community feed API with pagination + filter params.
- [ ] Event creation UI + community page integration.
- [ ] Notification templates (new event, RSVP reminders, announcements).
- [ ] Admin tooling for community moderators (web UI or CLI for MVP).
- [ ] Metrics dashboards for community engagement (active users per community, event RSVPs).

## 4. Acceptance Criteria
- User can navigate to `/com/{province}/{slug}`, see blended feed, follow/unfollow communities.
- Creating an event posts to the community feed, appears in discovery, supports RSVP changes.
- Auto-enrollment assigns new users to home community based on postal code input.
- Moderators can pin/remove content; reports escalate successfully.
- Nearby community content visibly blends according to configured ratio.

## 5. Dependencies & Notes
- Builds on Milestone 1 geo + content services; consumes friend graph for event invites.
- Ticket payments remain stubbed until wallet milestone; for now RSVPs handle capacity checks.
- Ensure accessibility/localization groundwork (bilingual naming, timezone handling).
