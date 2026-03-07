# Android signing (builds)

This folder is the canonical place for Android keystores used to sign Play Store builds.

- Keep any `.jks` / `.keystore` files here.
- Do not commit these files.
- The Capacitor Android project reads local signing values from `builds/mobile/capacitor/android/keystore.properties`.

Required keys in `builds/mobile/capacitor/android/keystore.properties`:

- `storeFile`
- `storePassword`
- `keyAlias`
- `keyPassword`

The Android release build also supports these environment variables:

- `CIVIL_ANDROID_VERSION_CODE`
- `CIVIL_ANDROID_VERSION_NAME`

Use the root release script to build publishable Android artifacts:

- `python3 _BUILD_ANDROID.py`
