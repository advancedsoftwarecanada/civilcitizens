# Mobile

This directory contains the native mobile shell(s) used for app publishing.

## What’s here

- `capacitor/` — Capacitor wrapper project (contains `ios/` + `android/`).
- `assets/` — Inputs synced from `../CIVIL/` (currently `logo.png`).
- `state/` — Hash manifest and sync state (written by `_FETCH.py`).

## What is intentionally *not* used

- Any legacy Meteor app artifacts (e.g. `.meteor/`).
- Generated build output from the Next.js app (e.g. `.next/`, `tmp/`).

## Updating after SCP

From `builds/`:

- Run `python3 _FETCH.py`

This will also regenerate native icon/splash assets via `@capacitor/assets` using `mobile/capacitor/assets/logo.png` as input.

Then open the native projects:

- iOS: `mobile/capacitor/ios/App/App.xcworkspace`
- Android: `mobile/capacitor/android/`
