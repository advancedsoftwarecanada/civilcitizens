# Civil APNs Service (standalone)

This is a tiny standalone APNs sender + device-token registry that lives entirely in `CIVIL_BUILD/`.
It exists because we are **not modifying** the main `CIVIL/` backend right now.

## What it does

- `POST /register` — store an iOS device token (from the app).
- `POST /send-test` — send a test push to a specific device token.

## Install

From this folder:

- `pnpm i`
- `pnpm start`

## Environment variables

Required for sending:

- `APNS_KEY_PATH` — path to your `.p8` file (ex: `CIVIL_BUILD/mobile/ios/signing/apns/AuthKey_XXXX.p8`)
- `APNS_KEY_ID` — Apple Key ID
- `APNS_TEAM_ID` — Apple Team ID
- `APNS_BUNDLE_ID` — bundle id / APNs topic (ex: `ca.civilcitizens`)

Optional:

- `APNS_USE_SANDBOX` — `true` for development builds; omit/false for TestFlight/App Store
- `PORT` — defaults to `8787`
- `PUSH_REGISTER_SECRET` — if set, app must send header `x-register-secret`
- `PUSH_ADMIN_SECRET` — if set, `send-test` requires header `x-admin-secret`

## Test flow (recommended)

1) Start the service.
2) Build/run the iOS app on a real device.
3) The app will log the APNs device token and call `/register`.
4) Send a test push:

- `curl -X POST http://localhost:8787/send-test \
  -H 'content-type: application/json' \
  -H 'x-admin-secret: YOUR_SECRET' \
  -d '{"deviceToken":"<hex>","title":"Civil","message":"Hello from APNs"}'`

If APNs returns `403` or `400`, the response body usually explains why (bad token, topic mismatch, wrong environment, etc.).
