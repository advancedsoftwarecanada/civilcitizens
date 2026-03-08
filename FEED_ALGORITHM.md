FEED_ALGORITHM.md
Overview

The Civil feed algorithm prioritizes fresh, unseen, and locally relevant content while ensuring that users in low population areas still receive a full feed.

The system is deterministic and transparent. It does not rely on opaque engagement ranking. Instead it prioritizes:

Unseen posts

Recent posts

Local relevance

Community relevance

Engagement signals (light weighting)

Each feed view applies the same core logic but with different content filters.

Core Concept: Impression Tracking

Civil tracks post impressions per user.

An impression is recorded when a post becomes visible in the feed.

user_post_impressions

userId
postId
firstSeenAt
lastSeenAt
impressionCount

This enables the feed to prioritize content the user has not seen yet.

Feed Types

Civil has several feed contexts.

Each uses the same ranking system but different filters.

/home

Combined feed including:

friends

network

organizations

community

events

marketplace

Mixed together using weighted distribution.

/friends

Strictly friend posts.

Rules:

Only posts from confirmed friends

Prioritize unseen posts

Then recent posts

Then previously seen posts

Important behavior:

If the user leaves mid-scroll, the next visit prioritizes posts they have not yet seen.

Seen posts can still reappear later.

/network

Similar to friends but includes:

professional connections

extended network

Geography does not apply here.

Ranking:

unseen posts

recent posts

engagement signals

/community

Community content is location aware.

Communities represent geographic regions.

Ranking priority:

posts from user's home community

posts from nearby communities

posts from extended regional communities

/events

Events are geographically bound.

Ranking priority:

upcoming events in home community

nearby communities

regional expansion

Events should also prioritize soonest start time.

/organizations

Content from organizations the user follows.

Ranking priority:

organizations user follows

organizations active in user's community

nearby community organizations

Geographic Expansion

When a feed has insufficient content, Civil expands geographically.

Expansion levels:

Level 1
User's primary community

Level 2
Nearby communities (within radius)

Level 3
Regional communities

Level 4
National fallback

Expansion occurs only when necessary.

Feed Construction Process

Feed generation occurs in stages.

Stage 1 — Candidate Pool

Collect posts matching feed filters.

Example for /community:

home community posts
+ nearby community posts
+ regional posts
Stage 2 — Impression Filter

Separate into:

unseen posts
seen posts

Unseen posts are prioritized.

Stage 3 — Freshness Sort

Within each group:

newest first
Stage 4 — Engagement Signals

Light engagement signals may reorder slightly:

likes
comments
shares

But this should never overpower recency.

Civil is not an outrage algorithm.

Feed Mixing Rules

For /home feeds:

Recommended mix:

30% friends
20% network
20% community
15% organizations
10% events
5% marketplace

If one category has no content, its share is redistributed.

Within those weights, each home-feed build randomizes which category is pulled next so refreshes do not feel static.
That randomization should stay stable for the duration of one pagination session, then reshuffle on a fresh load.

Seen Content Recycling

Once a user has seen all available posts:

The feed begins recycling older content.

Order:

1 unseen posts
2 lightly seen posts
3 heavily seen posts

Posts with very high impression counts should slowly decay in ranking.

Preventing Feed Confusion

If a user recently interacted with a post (liked, commented, viewed):

That post receives a temporary boost to remain visible.

Example:

User sees:

Halloween Party Kingston

They return to feed later.

The system ensures the event can still appear for a period of time.

Impression Trigger Rules

An impression is recorded when:

post visible > 50% in viewport
duration > 1 second

This prevents accidental impressions.

Cold Start Strategy

For new users or empty communities:

The system expands faster.

Example:

home community
→ nearby communities
→ province
→ Canada

This ensures the feed is never empty.

Anti Manipulation

Civil does not reward:

rage posts

engagement bait

outrage content

Engagement is used lightly, not as the primary ranking signal.

Design Philosophy

Civil is designed to be:

chronological

transparent

geographically relevant

socially healthy

The feed exists to help citizens discover useful local activity, not maximize addictive engagement.
