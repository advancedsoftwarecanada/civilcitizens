# Friends, Notifications, and Top Bar Initiative

## Objectives
- Introduce a friend graph so users can connect and control who appears in their home feed.
- Add notifications for social events (friend requests, acceptances, future extensibility).
- Modernize site chrome with a persistent top bar that houses branding, global search, and notifications.
- Transition the home feed from "all public" to "friends + self + followed communities" once critical mass exists.

## Milestones

### M1: Data Model & API Foundations
1. **Prisma & Database**
   - Add `Friendship` model with fields: `id`, `requesterId`, `addresseeId`, `status` (`pending | accepted | rejected`), `createdAt`, `respondedAt`.
   - Unique constraint on `(requesterId, addresseeId)`; enforce ordering to avoid duplicates.
   - Add `Notification` model upgrade (if not already) to include `type`, `payload`, `readAt`.

2. **Endpoints**
   - `POST /friends/requests` – create a pending friendship.
   - `GET /friends/requests` – list incoming/outgoing pending requests.
   - `POST /friends/requests/:id/accept` / `:id/reject` – resolve a request.
   - `GET /friends` – list accepted friends.
   - `POST /notifications/ack` – batch mark-as-read (optional but nice).

3. **Events**
   - On create request → emit notification for addressee.
   - On accept → emit notification back to requester.

4. **Feed Gate**
   - Update `/posts` query builder to accept `viewerFriends` filter.
   - Always filter home feed by friends + self + followed communities once backend live.

### M2: Frontend Friend Workflow
1. **Profile CTAs**
   - Add `useFriendships` hook to fetch relationship state (none, pending, accepted).
   - Buttons: "Add Friend", "Request Sent", "Accept / Decline", "Friends".

2. **Friends Hub**
   - New `/friends` page or sidebar drawer showing pending + accepted lists.
   - Actions inline (accept/decline/cancel).

3. **Integration Touchpoints**
   - Post headers show friend badge.
   - Community cards optionally include "Add friend" for authors.

### M3: Notifications & Top Bar
1. **Global Top Bar Component**
   - Layout: left logo, center search (users + communities), right icons (notifications bell, friend badge, avatar dropdown).
   - Make it sticky across main layouts (`DashboardShell`).

2. **Notifications UI**
   - Clicking bell opens panel with grouped events (requests, accepts, future use).
   - Polling every ~30s or use SSE if infrastructure available.

3. **Search**
   - Basic typeahead hitting `/search?q` (aggregate users + communities) or reusing existing endpoints.
   - Keyboard shortcut `/` to focus search.

### M4: Home Feed Flip + Enhancements
1. **Feed Switch**
   - Enable friend-filtered home feed (friends + self + followed communities) when user has any friends; otherwise show onboarding empty state.

2. **Empty States & Education**
   - Encourage sending friend requests if feed empty.
   - Surface recommended friends (shared follows, same community).

3. **Metrics & Logging**
   - Instrument request/accept events for analytics.
   - Track notification CTR for future iterations.

## Implementation Notes
- **Security**: validate users can only accept/decline requests addressed to them; prevent duplicate requests.
- **Performance**: index `Friendship` on `(requesterId, status)` and `(addresseeId, status)` for dashboards.
- **Extensibility**: notifications payload stored as JSON so future types (post likes, comments) slot in.
- **Feature Flags**: use env-driven flags for notifications panel and feed filtering to allow partial deploys.

## Next Steps
1. Ship M1 (DB + API) with stubbed frontend (no visible change) to unblock future work.
2. Implement global top bar skeleton so notifications/search have a home.
3. Layer friend request UI + notification bell, then flip feed flag once adoption verified.

## API Surface (current)

- `POST /friends/requests` → body `{ "userId": string }`; creates/refreshes a pending friendship and emits a `friend_request` notification to the addressee.
- `GET /friends/requests` → returns `{ incoming: FriendRequest[], outgoing: FriendRequest[] }` where each entry includes `id`, `status`, `direction`, `requestedAt`, and the counterpart user summary.
- `POST /friends/requests/:id/accept|reject` → addressee-only endpoints that transition the request to `accepted` (emits `friend_accept`) or `rejected`.
- `GET /friends` → accepted relationships with `since` timestamp plus compact user profile for rendering friends lists.
- `POST /notifications/ack` → mark notifications as read by `ids` or a `before` timestamp (useful for clearing badges after consuming the SSE stream).
- Home feed now always limits results to friends + self + followed communities when viewing as an authenticated user; anonymous visitors continue to see the global public feed.
