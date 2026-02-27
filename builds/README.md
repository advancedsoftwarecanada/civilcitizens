# builds

Build and publishing workspace for native mobile shells.

This folder is intentionally separate from the SCP-synced app source in `../CIVIL/`.

## Mobile wrapper

- Capacitor project: `mobile/capacitor/`
- Source assets synced from `../CIVIL/`: `mobile/assets/`
- Sync state/manifest: `mobile/state/`

## Workflow (current)

1. SCP updated app source into `../CIVIL/`.
2. Run `python3 _FETCH.py` from this folder.
   - Syncs production base URL into Capacitor config
   - Syncs `logo.png` and auto-generates iOS/Android icon + splash assets
3. Open:
   - Xcode: `mobile/capacitor/ios/App/App.xcworkspace`
   - Android Studio: `mobile/capacitor/android/`
