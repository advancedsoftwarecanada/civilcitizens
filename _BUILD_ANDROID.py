#!/usr/bin/env python3
"""Build the signed Android release artifacts and publish the APK and AAB.

Usage:
  python3 _BUILD_ANDROID.py

What it does:
    1. Builds the Android release APK and AAB from the Capacitor project.
    2. Verifies the APK signature with `apksigner` when available.
    3. Copies the final APK into `civil/apps/web/public/android/`.
    4. Copies the final AAB into `builds/mobile/android/release/` for Google Play upload.
    5. Reads and advances the repo-tracked Android version code file.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent
ANDROID_PROJECT_DIR = REPO_ROOT / "builds" / "mobile" / "capacitor" / "android"
ANDROID_OUTPUT_APK = ANDROID_PROJECT_DIR / "app" / "build" / "outputs" / "apk" / "release" / "app-release.apk"
ANDROID_OUTPUT_AAB = ANDROID_PROJECT_DIR / "app" / "build" / "outputs" / "bundle" / "release" / "app-release.aab"
ANDROID_RELEASE_DIR = REPO_ROOT / "builds" / "mobile" / "android" / "release"
ANDROID_VERSION_CODE_FILE = REPO_ROOT / "builds" / "mobile" / "android" / "version-code.txt"
WEB_PUBLIC_ANDROID_DIR = REPO_ROOT / "civil" / "apps" / "web" / "public" / "android"
PUBLISHED_AAB = ANDROID_RELEASE_DIR / "Civil-android-release.aab"
PUBLISHED_AAB_PLAY = ANDROID_RELEASE_DIR / "civil.aab"
ANDROID_STUDIO_JAVA = Path("/Applications/Android Studio.app/Contents/jbr/Contents/Home")
ANDROID_SDK = Path.home() / "Library" / "Android" / "sdk"
PUBLISHED_APK = WEB_PUBLIC_ANDROID_DIR / "civil.apk"


def _run(command: list[str], *, cwd: Path, env: dict[str, str]) -> None:
    printable = " ".join(command)
    print(f"$ {printable}")
    subprocess.run(command, cwd=str(cwd), env=env, check=True)


def _resolve_apksigner(android_home: Path) -> Path | None:
    build_tools_dir = android_home / "build-tools"
    if not build_tools_dir.is_dir():
        return None

    versions = sorted((path for path in build_tools_dir.iterdir() if path.is_dir()), key=lambda p: p.name)
    for version_dir in reversed(versions):
        apksigner = version_dir / "apksigner"
        if apksigner.is_file():
            return apksigner
    return None


def _read_version_code(path: Path) -> int:
    if not path.is_file():
        raise FileNotFoundError(f"Missing Android version code file: {path}")

    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        raise ValueError(f"Android version code file is empty: {path}")

    version_code = int(raw)
    if version_code < 1:
        raise ValueError(f"Android version code must be >= 1: {path}")
    return version_code


def _write_version_code(path: Path, version_code: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{version_code}\n", encoding="utf-8")


def main() -> int:
    if not ANDROID_PROJECT_DIR.is_dir():
        print(f"Error: missing Android project at {ANDROID_PROJECT_DIR}", file=sys.stderr)
        return 2

    if not ANDROID_STUDIO_JAVA.is_dir():
        print(f"Error: missing Android Studio Java runtime at {ANDROID_STUDIO_JAVA}", file=sys.stderr)
        return 2

    if not ANDROID_SDK.is_dir():
        print(f"Error: missing Android SDK at {ANDROID_SDK}", file=sys.stderr)
        return 2

    env = os.environ.copy()
    env["JAVA_HOME"] = str(ANDROID_STUDIO_JAVA)
    env["ANDROID_HOME"] = str(ANDROID_SDK)
    env["ANDROID_SDK_ROOT"] = str(ANDROID_SDK)
    env["PATH"] = f"{ANDROID_STUDIO_JAVA / 'bin'}:{env.get('PATH', '')}"

    version_code_override = (env.get("CIVIL_ANDROID_VERSION_CODE") or "").strip()
    if version_code_override:
        version_code = int(version_code_override)
        version_source = "env:CIVIL_ANDROID_VERSION_CODE"
    else:
        version_code = _read_version_code(ANDROID_VERSION_CODE_FILE)
        env["CIVIL_ANDROID_VERSION_CODE"] = str(version_code)
        version_source = str(ANDROID_VERSION_CODE_FILE)

    print(f"Using Android version code {version_code} from {version_source}")

    _run(["./gradlew", "clean", "assembleRelease", "bundleRelease"], cwd=ANDROID_PROJECT_DIR, env=env)

    if not ANDROID_OUTPUT_APK.is_file():
        print(f"Error: expected APK not found at {ANDROID_OUTPUT_APK}", file=sys.stderr)
        return 1
    if not ANDROID_OUTPUT_AAB.is_file():
        print(f"Error: expected AAB not found at {ANDROID_OUTPUT_AAB}", file=sys.stderr)
        return 1

    apksigner = _resolve_apksigner(ANDROID_SDK)
    if apksigner is not None:
        _run([str(apksigner), "verify", "--print-certs", str(ANDROID_OUTPUT_APK)], cwd=ANDROID_PROJECT_DIR, env=env)
    else:
        print("Warning: apksigner not found; skipping signature verification")

    ANDROID_RELEASE_DIR.mkdir(parents=True, exist_ok=True)
    WEB_PUBLIC_ANDROID_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ANDROID_OUTPUT_APK, PUBLISHED_APK)
    shutil.copy2(ANDROID_OUTPUT_AAB, PUBLISHED_AAB)
    shutil.copy2(ANDROID_OUTPUT_AAB, PUBLISHED_AAB_PLAY)

    if not version_code_override:
        next_version_code = version_code + 1
        _write_version_code(ANDROID_VERSION_CODE_FILE, next_version_code)
    else:
        next_version_code = version_code

    print()
    print(f"Built APK: {ANDROID_OUTPUT_APK}")
    print(f"Built AAB: {ANDROID_OUTPUT_AAB}")
    print(f"Published APK: {PUBLISHED_APK}")
    print(f"Published AAB: {PUBLISHED_AAB}")
    print(f"Google Play AAB: {PUBLISHED_AAB_PLAY}")
    print(f"Android version code used: {version_code}")
    print(f"Next Android version code: {next_version_code}")
    print(f"Web path: /android/{PUBLISHED_APK.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())