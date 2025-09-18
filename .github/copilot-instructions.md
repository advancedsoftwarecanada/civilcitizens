# Civil Citizens – AI coding assistant guide

Big picture
- Meteor 3 app (no classic publications for feeds). Front end is API-first; only minimal subs for own data. See client cache in `client/userManager.js` and HTTP endpoints in `server/api/*`.
- CORS is enabled globally and OPTIONS handled in `server/main.js`. Prefer same-origin relative URLs on the client (e.g., `/api/user`).

Key directories/files
- Collections and indexes: `libs/1_collections.js` (e.g., `Posts`, `Votes`, `ChamberFollows`, `UserMeta`, `ApiFiles`). Use async collection APIs: `findOneAsync`, `insertAsync`, `updateAsync`.
- Server API: `server/api/` (e.g., `posts.js`, `post.js`, `user.js`, `events.js`, `comments.js`, `files.js`, `chambers.js`). All are `WebApp.connectHandlers` routes with JSON bodies via `body-parser` or manual parse.
- Client cache/orchestration: `client/userManager.js` (IndexedDB-backed cache + DOM helpers) and `client/main.js` (startup flow, FlowRouter, Blaze helpers).
- Dev/build scripts: `./dev.sh` (startdev, buildios, buildandroid, buildserver). Settings: `settings-localhost.json`, `settings-pm2.json`.

Auth pattern (Meteor 3)
- Client sends `Authorization: Bearer <Meteor.loginToken>` from `localStorage`.
- Server validates with `Accounts._hashLoginToken(token)` and `Meteor.users.findOneAsync({ 'services.resume.loginTokens.hashedToken': hashed })`.
- Example: `server/api/user.js` and `server/api/posts.js`.

HTTP endpoints (examples and conventions)
- Posts
  - Create: `POST /api/posts/submit` (body includes `type: 'self'|'chamber'|'topic'`, optional `draft: true`). Generates `seoUrl`, sets `jurisdiction`: `federal` for chamber, `citizen` otherwise. Images normalized to `images: [{ id, url }]` using `ApiFiles` when `attachments.type==='images'`.
  - Update: `PUT /api/posts/update` (validates title/body lengths, normalizes images, can publish a draft and update `createdAt`).
  - Fetch by SEO: `GET /api/post?seo_url=...` returns post with author and latest comments.
- Events: `POST /api/events` with `{ action: 'upvote'|'downvote'|'follow'|'unfollow', ... }` delegates to Meteor methods like `'posts.vote'` and `'chambers.follow'`.
- User: `GET /api/user?id=:id` returns `{ meta, chamberFollows, votes, userFollowing }` for caching in `UserManager`.
- Comments: `POST /api/comments` persists a comment and increments `commentCount`.
- Files: `POST /api/files/upload` (multipart via `multer`) stores to `Meteor.settings.public.filesPath`, records in `ApiFiles` with CDN URL from `settings.public.cdnPath`. Include `type` (e.g., `avatar`, `cover`, `images`) and optional `draftPostId`. `GET /api/files/:id` redirects to CDN URL.

Client patterns
- `client/userManager.js` is the front-end cache: stores `{ chambers, votes, bookmarks, chamberFollows, userFollowing, draftPostId }` in IndexedDB; exposes helpers for voting, follow/unfollow, and content linkification. Use it to avoid extra subscriptions and to keep the UI reactive.
- On login (`client/main.js`), fetch `/api/user`, ensure a draft post via `POST /api/posts/submit { draft: true }`, then mark `window.userDataReady = true`. Most UI helpers read from `userManager.getData()` reactively.

Data model highlights
- Posts: `{ _id, type, authorId, title, body, seoUrl, voteCount, commentCount, images?, attachments?, draft, nsfw?, jurisdiction }`.
- Votes: `{ userId, postId, vote }` with server-side increments/decrements of `Posts.voteCount`.
- Follows: `ChamberFollows` documents `{ userId, province, chamber, home? }` and counters on `Chambers.stats`.

Do/Don’t for this repo
- Do implement new features as HTTP endpoints under `server/api/*` using `WebApp.connectHandlers` and async Mongo calls. Keep responses JSON.
- Do reuse the token auth pattern shown above. Prefer relative URLs on the client.
- Do update indexes in `libs/1_collections.js` if you add new query patterns.
- Don’t add new Meteor subscriptions; if absolutely needed, limit to the current user’s own data. Don’t use `findOne` (Meteor 3 removed it)—use `findOneAsync`.
- Don’t proxy uploaded files through the app; always store metadata in `ApiFiles` and link to the CDN URL from settings.

Handy commands
- Dev server: `./dev.sh startdev` (uses `settings-localhost.json`, binds 127.0.0.1:3000 with ROOT_URL set).
- Mobile/server builds: see `./dev.sh buildios`, `buildandroid`, `buildserver`. Meteor is managed outside of chat; no need to start it here.

Where to look first when extending
- Endpoints similar to your use case in `server/api/` (follow naming and auth). Mirror the client caching pattern by extending `UserManager` only when data needs to be reflected instantly.
