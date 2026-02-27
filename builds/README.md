# builds

Build and publishing workspace for native mobile shells.

## Mobile wrapper

- Capacitor project: `mobile/capacitor/`
- Local build assets: `mobile/assets/`

## Workflow

1. Ensure `mobile/capacitor/capacitor.config.json` has the correct `server.url`.
2. If the logo changed, copy:
   - From: `../civil/apps/web/public/logo.png`
   - To: `mobile/assets/logo.png`
   - And: `mobile/capacitor/assets/logo.png`
3. Regenerate native icon/splash assets:
   - `cd mobile/capacitor && pnpm assets:generate`
4. Open:
   - Xcode: `mobile/capacitor/ios/App/App.xcworkspace`
   - Android Studio: `mobile/capacitor/android/`
