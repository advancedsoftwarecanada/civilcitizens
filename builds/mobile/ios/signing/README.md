# iOS signing (builds)

This folder is the canonical place on the production Mac for iOS signing artifacts you generate during publishing and push notification setup.

Do **not** SCP these files back into `CIVIL/`.

## Recommended: APNs Auth Key (no CSR needed)

For push notifications, Apple’s preferred approach is an **APNs Auth Key** (`.p8`). It does **not** require a CSR.

- Apple Developer → Certificates, Identifiers & Profiles → **Keys** → create a key with **Apple Push Notifications service (APNs)** enabled.
- Download the `.p8` once and store it here.

Store:
- `apns/AuthKey_XXXXXXXXXX.p8`
- `apns/key-id.txt` (the Key ID)
- `apns/team-id.txt` (your Apple Team ID)

### Using the standalone APNs service in builds

If we are not modifying the main `CIVIL/` backend, you can still test push end-to-end via the standalone sender in:

- `builds/push/apns-service/`

You will need these values from Apple:

- **Team ID**
- **Key ID**
- The `.p8` file
- Your app’s **Bundle ID** (topic), currently `ca.civilcitizens`

## If you specifically need a CSR (Certificate Signing Request)

You’ll create the CSR on this Mac via Keychain Access. The private key stays in your Keychain; the `.csr` is safe to upload to Apple.

### Create the CSR (Keychain Access)

1. Open **Keychain Access** (Applications → Utilities).
2. Menu: **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority…**
3. Fill:
   - **User Email Address**: your Apple Developer account email.
   - **Common Name**: `Civil iOS Push/Auth` (any descriptive name is fine).
   - **CA Email Address**: leave blank.
   - Select **Saved to disk**.
   - (Optional) select **Let me specify key pair information** → use RSA 2048.
4. Save the CSR to:
   - `builds/mobile/ios/signing/csr/civil-ios.csr`

Create the folder `csr/` under this directory if it doesn’t exist.

### What this CSR is used for

- **App Distribution certificates** (App Store builds)
- **Apple Push Services certificates** (legacy APNs cert flow)

If your goal is push notifications, prefer the **APNs Auth Key** approach above unless you have a specific reason to use certificates.

## Safety

- Never export or store private keys unencrypted.
- If you must export a `.p12`, put it here and protect it with a strong password; do not commit it.
