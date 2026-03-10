# Civil Push Service (standalone)

This is a tiny standalone native push sender + device-token registry that lives entirely in `builds/`.
It exists because we are **not modifying** the main `CIVIL/` backend right now.

## What it does

- `POST /register` — store a native device token from the app.
- `POST /send-test` — send a test push to a specific device token.

## Install

From this folder:

- `pnpm i`
- `pnpm start`

## Environment variables

Required for iOS / APNs sending:

- `APNS_KEY_PATH` — path to your `.p8` file (ex: `builds/mobile/ios/signing/apns/AuthKey_XXXX.p8`)
- `APNS_KEY_ID` — Apple Key ID
- `APNS_TEAM_ID` — Apple Team ID
- `APNS_BUNDLE_ID` — bundle id / APNs topic (ex: `ca.civilcitizens`)

Required for Android / FCM sending:

- `FCM_PROJECT_ID` — Firebase project id
- `FCM_CLIENT_EMAIL` — service account client email
- `FCM_PRIVATE_KEY` — service account private key, with `\n` escaped newlines

Alternative Android credential input:

- `FCM_SERVICE_ACCOUNT_JSON` — raw service-account JSON string

Optional:

- `APNS_USE_SANDBOX` — `true` for development builds; omit/false for TestFlight/App Store
- `PORT` — defaults to `8787`
- `PUSH_REGISTER_SECRET` — if set, app must send header `x-register-secret`
- `PUSH_ADMIN_SECRET` — if set, `send-test` requires header `x-admin-secret`

## Test flow (recommended)

1) Start the service.
2) Build/run the native app on a real device.
3) The app will register its native device token and call `/register`.
4) Send a test push:

- `curl -X POST http://localhost:8787/send-test \
  -H 'content-type: application/json' \
  -H 'x-admin-secret: YOUR_SECRET' \
  -d '{"platform":"ios","deviceToken":"<hex>","title":"Civil","message":"Hello from APNs"}'`

If APNs returns `403` or `400`, the response body usually explains why (bad token, topic mismatch, wrong environment, etc.).

Android example:

- `curl -X POST http://localhost:8787/send-test \
  -H 'content-type: application/json' \
  -H 'x-admin-secret: YOUR_SECRET' \
  -d '{"platform":"android","deviceToken":"<fcm-token>","title":"Civil","message":"Hello from FCM"}'`
