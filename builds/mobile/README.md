# Mobile

This directory contains the native mobile shell(s) used for app publishing.

## What’s here

- `capacitor/` — Capacitor wrapper project (contains `ios/` + `android/`).
- `assets/` — Local inputs for native build/publishing (currently `logo.png`).

## What is intentionally *not* used

- Any legacy Meteor app artifacts (e.g. `.meteor/`).
- Generated build output from the Next.js app (e.g. `.next/`, `tmp/`).

## Updating native shell

1. Ensure `capacitor/capacitor.config.json` has the correct `server.url`.
2. If the logo changed, copy it into:
	- `assets/logo.png`
	- `capacitor/assets/logo.png`
3. Regenerate native icon/splash assets via `@capacitor/assets`:
	- `cd capacitor && pnpm assets:generate`

Then open the native projects:

- iOS: `mobile/capacitor/ios/App/App.xcworkspace`
- Android: `mobile/capacitor/android/`

## Release commands

- Android public test APK + Play Store bundle:
	- `python3 _BUILD_ANDROID.py`
