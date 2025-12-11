# @civil/web

Next.js front-end for Civil. Run in dev:

pnpm --filter @civil/web dev

## Configuration

### Google Analytics

To enable Google Analytics tracking:

1. Copy the appropriate environment example file:
   - For development: `cp .env.dev.example .env.dev` (from repo root)
   - For production: `cp .env.production.example .env.production` (from repo root)

2. Set the `NEXT_PUBLIC_GTAG_ID` variable to your Google Analytics tag ID (e.g., `G-1ML0TFH7F0`)

3. Leave `NEXT_PUBLIC_GTAG_ID` empty or unset to disable Google Analytics

The Google Analytics scripts will only load when `NEXT_PUBLIC_GTAG_ID` is configured, making it safe to leave disabled in development environments.
