# Push notifications (builds-only)

This setup enables native push notifications with device registration flowing into the Civil API.

## Architecture (current)

- iOS Capacitor shell registers with APNs.
- Android Capacitor shell registers with FCM.
- The shell POSTs the native device token to the API endpoint `/mobile/push/register`.
- The standalone service in `builds/push/apns-service/` sends native pushes through APNs for iOS and FCM HTTP v1 for Android.

This remains build-oriented for native shell verification.

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

This must match the native app registration secret.

## 3) Android Firebase requirements

Android native push will not work until both of these are present:

- `builds/mobile/capacitor/android/app/google-services.json`
- FCM sender credentials in the standalone push service environment

The Firebase Android app must use this exact package name:

- `ca.civilcitizens`

Place the Firebase Android app config file here:

- `builds/mobile/capacitor/android/app/google-services.json`

For the sender, provide either:

- `FCM_SERVICE_ACCOUNT_JSON='<raw Firebase service-account JSON>'`

Or split variables:

- `FCM_PROJECT_ID="<project-id>"`
- `FCM_CLIENT_EMAIL="<service-account-email>"`
- `FCM_PRIVATE_KEY="<escaped Firebase private key from the service account>"`

## 4) Run the standalone native push service (optional, for direct test sends)

From `builds/push/apns-service/`:

- `pnpm i`
- Set env vars (example):

  - `export APNS_KEY_PATH="../../mobile/ios/signing/apns/AuthKey_<KEYID>.p8"`
  - `export APNS_KEY_ID="<KEYID>"`
  - `export APNS_TEAM_ID="<TEAMID>"`
  - `export APNS_BUNDLE_ID="ca.civilcitizens"`
  - `export PUSH_ADMIN_SECRET="<choose-a-secret>"`
  - `export PUSH_REGISTER_SECRET="<choose-a-secret>"`
  - `export FCM_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'`

- `pnpm start`

The service listens on `http://localhost:8787` by default.

## 5) Point the native app at API registration

Edit this file (build-only):
- `builds/mobile/capacitor/ios/App/App/Info.plist`

Set:
- `CIVILPushServiceURL` → `https://civilcitizens.ca/api/mobile/push`
- `CIVILPushRegisterSecret` → same value as `PUSH_REGISTER_SECRET`

Notes:
- If testing against a local API server, use your Mac LAN IP (not `localhost`).

Android notes:

- `builds/mobile/capacitor/android/app/build.gradle` already checks for `google-services.json`.
- If that file is missing, the Android app can build, but push registration will not work.

## 6) Build + run on a real device

In Xcode:
- Ensure Signing is correct for your device.
- Run.
- Allow notifications when prompted.

In Xcode logs you should see:
- `push_device_token <hex>`

The API should receive `POST /mobile/push/register` and return `{ "ok": true }`.

On Android:

- Sync/build the Capacitor app after adding `google-services.json`.
- Install on a real device.
- Allow notifications when prompted.

The API should receive `POST /mobile/push/register` with `platform: "android"` and return `{ "ok": true }`.

## 7) Send a test push (standalone sender)

- Copy the token hex string.
- Run:

`curl -X POST http://localhost:8787/send-test \
  -H 'content-type: application/json' \
  -H 'x-admin-secret: <choose-a-secret>' \
  -d '{"deviceToken":"<hex>","title":"Civil","message":"Hello from APNs"}'`

Android:

`curl -X POST http://localhost:8787/send-test \
  -H 'content-type: application/json' \
  -H 'x-admin-secret: <choose-a-secret>' \
  -d '{"platform":"android","deviceToken":"<fcm-token>","title":"Civil","message":"Hello from FCM"}'`

## Custom notification sounds

- iOS custom push sounds must exist in the app bundle as CAF, WAV, or AIFF files. Civil ride contract updates use `NotificationSFX/honk-honk.caf` and the API sends `sound: "honk-honk.caf"` for those pushes.
- Android 8+ custom notification sounds are controlled by the notification channel, not only by the push payload. Civil ride contract updates use the `drive_ride_updates` channel, which is configured in `MainActivity.java` to play `res/raw/honk_honk.mp3`.
- If you change an existing Android channel's sound, the OS may keep the old sound for installed builds. Use a new channel id or reinstall/clear app notification settings when testing channel sound changes.

## Troubleshooting

- If APNs returns `400 BadDeviceToken`:
  - You’re likely sending to the wrong APNs environment.
  - Development builds typically need `APNS_USE_SANDBOX=true`.
  - TestFlight/App Store builds use production.

- If APNs returns `403`:
  - Key not authorized for the topic, wrong Team ID/Key ID, or mismatched bundle id.

- If the phone never prompts for notification permission:
  - Remove/reinstall the app, or check Settings → Notifications → Civil.

- If Android never produces a token:
  - Confirm `builds/mobile/capacitor/android/app/google-services.json` exists.
  - Confirm the Firebase project in `google-services.json` matches the FCM service-account credentials.
  - Confirm the push sender has either `FCM_SERVICE_ACCOUNT_JSON` or all of `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, and `FCM_PRIVATE_KEY`.
