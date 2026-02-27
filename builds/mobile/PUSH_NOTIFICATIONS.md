# Push notifications (builds-only)

This setup enables APNs push notifications **without changing any code under `civil/`**.

## Architecture (current)

- iOS Capacitor shell registers with APNs.
- The shell POSTs the device token to a tiny standalone service in `builds/push/apns-service/`.
- That service can send a test push to a specific device token using your Apple `.p8` key.

This is intentionally “build-only”: it does not yet integrate Civil’s server-side events.

## 1) Create/download the APNs `.p8`

- Apple Developer → Certificates, Identifiers & Profiles → **Keys**
- Create a key with **Apple Push Notifications service (APNs)** enabled
- Download the `.p8` file (only available once)

Store in:
- `builds/mobile/ios/signing/apns/AuthKey_<KEYID>.p8`

Also record:
- Key ID
- Team ID

## 2) Run the standalone APNs service

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

## 3) Point the iOS app at the service

Edit this file (build-only):
- `builds/mobile/capacitor/ios/App/App/Info.plist`

Set:
- `CIVILPushServiceURL` → `http://<your-mac-lan-ip>:8787` (device must reach it)
- `CIVILPushRegisterSecret` → same value as `PUSH_REGISTER_SECRET`

Notes:
- `localhost` from the phone is not your Mac; use your Mac’s LAN IP.

## 4) Build + run on a real device

In Xcode:
- Ensure Signing is correct for your device.
- Run.
- Allow notifications when prompted.

In Xcode logs you should see:
- `push_device_token <hex>`

The service should receive `/register` and save it in:
- `builds/push/apns-service/data/devices.json`

## 5) Send a test push

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
