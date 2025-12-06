# Milestone 5 – Work Pillar

> Objective: stand up the dedicated Work experience for jobs, contracts, gigs, and delivery opportunities, fully linked to Market and Community pillars.

## 1. Scope Overview
- **Job & Contract Board:** employer postings, filtering, application tracking.
- **Gig Marketplace:** short-term gigs (including auto-generated delivery jobs) with wallet escrow placeholders.
- **Profiles & Resumes:** employer pages, worker profiles, resume/skills builder, endorsements.
- **Communication & Workflow:** application messaging, status changes, offer letters, completions.

## 2. Key Components
1. **Work Posting Service**
   - Supports `job`, `contract`, `gig`, `delivery_gig` types with shared fields and type-specific extras (duration, pay structure, requirements).
   - Visibility controls (public, community members, friends-of-friends).
   - Application form builder (custom questions, file uploads).
2. **Application Tracking System (ATS-lite)**
   - Application states: `applied`, `reviewing`, `interview`, `offer`, `hired`, `rejected`, `withdrawn`.
   - Employer actions logged with timestamps and notes.
   - Candidate view of progress + messaging thread.
3. **Profiles & Resume Builder**
   - Worker profile with experience, education, certificates, skills; import from LinkedIn/resume file where possible.
   - Employer profile with organization info, verified badge, jobs history.
4. **Gig Workflow**
   - Accept/decline gig invites, check-in/out, proof-of-completion uploads.
   - Delivery gigs tied to Market orders; completion triggers ledger placeholder event.
5. **Search & Discovery**
   - Filters by location, pay, type, remote availability, skills required.
   - Personalized recommendations based on profile and community.

## 3. Deliverables Checklist
- [ ] Prisma models for work postings, applications, resumes, endorsements, gig assignments.
- [ ] UI flows for posting creation, application submission, ATS board, profile editing.
- [ ] Messaging integration for employer-candidate threads (reuse messaging service).
- [ ] Notification flows: new application, status updates, gig reminders.
- [ ] Analytics dashboards (jobs posted, applications per job, time-to-fill, gig completions).
- [ ] Documentation for policy/compliance (employment standards, gig safety guidelines).

## 4. Acceptance Criteria
- Employer can create job/contract/gig posts, manage applicants through lifecycle, and communicate with them.
- Worker can build profile/resume, apply, track status, and accept gigs (including delivery ones from Market).
- Delivery gig completion propagates status back to linked Market order.
- Notifications trigger at each workflow step; audit logs capture employer actions.
- Search results incorporate proximity, skills, and availability filters correctly.

## 5. Dependencies & Notes
- Builds on Milestone 4 delivery gig schema and messaging service from Milestone 2.
- Wallet payouts remain stubbed until Milestone 6 but ledger entries must be ready for replay.
- Ensure compliance hooks for employment regulations (record retention, consent for data usage).
