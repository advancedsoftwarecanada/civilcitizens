# Push notifications (builds-only)

This setup enables APNs push notifications with device registration flowing into the Civil API.

## Architecture (current)

- iOS Capacitor shell registers with APNs.
- The shell POSTs the device token to the API endpoint `/mobile/push/register`.
- The standalone service in `builds/push/apns-service/` can still be used to send direct APNs test pushes with your Apple `.p8` key.

This remains build-oriented for iOS shell + APNs verification.

## 1) Create/download the APNs `.p8`

- Apple Developer → Certificates, Identifiers & Profiles → **Keys**
- Create a key with **Apple Push Notifications service (APNs)** enabled
- Download the `.p8` file (only available once)

Store in:
- `builds/mobile/ios/signing/apns/AuthKey_<KEYID>.p8`

Also record:
- Key ID
- Team ID

## 2) Configure API registration secret

Set in the API environment:

- `PUSH_REGISTER_SECRET="<choose-a-secret>"`
- `PUSH_DELIVERY_URL="http://<push-service-host>:8787"`
- `PUSH_ADMIN_SECRET="<same-admin-secret-used-by-apns-service>"`

This must match the iOS plist value (`CIVILPushRegisterSecret`).

## 3) Run the standalone APNs service (optional, for direct test sends)

From `builds/push/apns-service/`:

- `pnpm i`
- Set env vars (example):

  - `export APNS_KEY_PATH="../../mobile/ios/signing/apns/AuthKey_<KEYID>.p8"`
  - `export APNS_KEY_ID="<KEYID>"`
  - `export APNS_TEAM_ID="<TEAMID>"`
  - `export APNS_BUNDLE_ID="ca.civilcitizens"`
  - `export PUSH_ADMIN_SECRET="<choose-a-secret>"`
  - `export PUSH_REGISTER_SECRET="<choose-a-secret>"`

- `pnpm start`

The service listens on `http://localhost:8787` by default.

## 4) Point the iOS app at API registration

Edit this file (build-only):
- `builds/mobile/capacitor/ios/App/App/Info.plist`

Set:
- `CIVILPushServiceURL` → `https://civilcitizens.ca/api/mobile/push`
- `CIVILPushRegisterSecret` → same value as `PUSH_REGISTER_SECRET`

Notes:
- If testing against a local API server, use your Mac LAN IP (not `localhost`).

## 5) Build + run on a real device

In Xcode:
- Ensure Signing is correct for your device.
- Run.
- Allow notifications when prompted.

In Xcode logs you should see:
- `push_device_token <hex>`

The API should receive `POST /mobile/push/register` and return `{ "ok": true }`.

## 6) Send a test push (standalone APNs sender)

- Copy the token hex string.
- Run:

`curl -X POST http://localhost:8787/send-test \
  -H 'content-type: application/json' \
  -H 'x-admin-secret: <choose-a-secret>' \
  -d '{"deviceToken":"<hex>","title":"Civil","message":"Hello from APNs"}'`

## Troubleshooting

- If APNs returns `400 BadDeviceToken`:
  - You’re likely sending to the wrong APNs environment.
  - Development builds typically need `APNS_USE_SANDBOX=true`.
  - TestFlight/App Store builds use production.

- If APNs returns `403`:
  - Key not authorized for the topic, wrong Team ID/Key ID, or mismatched bundle id.

- If the phone never prompts for notification permission:
  - Remove/reinstall the app, or check Settings → Notifications → Civil.
