#!/usr/bin/env python3
"""Civil production runner (run on the server).

This script assumes you're already SSH'd into the production machine.
It does NOT rsync/upload code.

Default behavior is to deploy application updates while preserving infra services.
Successful deploy/build commands automatically prune old Docker build cache,
unused images, and stopped containers using age filters.

Usage:
    python3 _PROD.py                  # deploy + auto-prune old Docker cache/images
  python3 _PROD.py deploy           # same as default
    python3 _PROD.py build            # build images only + auto-prune old Docker cache/images
  python3 _PROD.py prune-build-cache  # free Docker build cache (fixes ENOSPC)
  python3 _PROD.py prune-docker      # free more Docker space (no volumes; fixes recurring ENOSPC)
  python3 _PROD.py status           # docker compose ps
  python3 _PROD.py logs             # follow logs
  python3 _PROD.py down             # docker compose down
  python3 _PROD.py rebuild-all      # down -v + build --no-cache + up -d

Notes:
  - "no space left on device" often refers to Docker's internal storage (overlay2), not your host disk.
    On Docker Desktop (macOS/Windows), you may need to increase the Docker Disk image size.

Env:
  - Pass `--env-file .env.production` (or `.env.production.googlecloud`) to control settings.
  - Or set `COMPOSE_PROJECT_NAME` to override the default project name.
"""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent
DEFAULT_ENV_CANDIDATES = (
    REPO_ROOT / ".env.production",
    REPO_ROOT / ".env.production.googlecloud",
)
BRAND_DOMAIN_REPLACEMENTS = (
    ("dev.civilcitizens.ca", "dev.civilrides.ca"),
    ("civilcitizens.ca", "civilrides.ca"),
)
FALLBACK_PROD_HOST = "civilrides.ca"


def _extract_env_file_arg(argv: list[str]) -> str | None:
    for idx, arg in enumerate(argv):
        if arg == "--env-file":
            return argv[idx + 1] if idx + 1 < len(argv) else None
        if arg.startswith("--env-file="):
            return arg.split("=", 1)[1]
    return None


def _resolve_env_path(raw_path: str) -> Path:
    path = Path(raw_path)
    if not path.is_absolute():
        path = REPO_ROOT / path
    return path


def _select_source_env_file(argv: list[str]) -> tuple[Path | None, bool]:
    explicit = _extract_env_file_arg(argv)
    if explicit is not None:
        resolved = _resolve_env_path(explicit)
        return resolved, resolved.is_file()

    for candidate in DEFAULT_ENV_CANDIDATES:
        if candidate.is_file():
            return candidate, True
    return None, False


def _has_env_key(text: str, key: str) -> bool:
    pattern = rf"^\s*(?:export\s+)?{re.escape(key)}\s*="
    return bool(re.search(pattern, text, flags=re.MULTILINE))


def _infer_public_host(text: str) -> str:
    patterns = (
        r"^\s*(?:export\s+)?CIVIL_PUBLIC_HOST\s*=\s*([^\s#]+)",
        r"^\s*(?:export\s+)?NEXT_PUBLIC_BASE_URL\s*=\s*https://([^/\s#]+)",
        r"^\s*(?:export\s+)?NEXT_PUBLIC_MEDIA_BASE_URL\s*=\s*https://([^/\s#]+)",
        r"^\s*(?:export\s+)?MEDIA_PUBLIC_BASE_URL\s*=\s*https://([^/\s#]+)",
        r"^\s*(?:export\s+)?MEETING_RTC_WS_URL\s*=\s*wss://([^/\s#]+)",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.MULTILINE)
        if match:
            return match.group(1).strip()
    return FALLBACK_PROD_HOST


def _build_branded_env_text(source_env_file: Path | None) -> str:
    env_text = source_env_file.read_text(encoding="utf-8") if source_env_file and source_env_file.is_file() else ""

    for old, new in BRAND_DOMAIN_REPLACEMENTS:
        env_text = env_text.replace(old, new)

    public_host = _infer_public_host(env_text)
    appended: list[str] = []
    if not _has_env_key(env_text, "CIVIL_PUBLIC_HOST"):
        appended.append(f"CIVIL_PUBLIC_HOST={public_host}")
    if not _has_env_key(env_text, "NEXT_PUBLIC_BASE_URL"):
        appended.append(f"NEXT_PUBLIC_BASE_URL=https://{public_host}")
    if not _has_env_key(env_text, "NEXT_PUBLIC_MEDIA_BASE_URL"):
        appended.append(f"NEXT_PUBLIC_MEDIA_BASE_URL=https://{public_host}/media")
    if not _has_env_key(env_text, "MEDIA_PUBLIC_BASE_URL"):
        appended.append(f"MEDIA_PUBLIC_BASE_URL=https://{public_host}/media")
    if not _has_env_key(env_text, "MEETING_RTC_WS_URL"):
        appended.append(f"MEETING_RTC_WS_URL=wss://{public_host}/rtc/v1/ws")

    if env_text and not env_text.endswith("\n"):
        env_text += "\n"
    if appended:
        env_text += "".join(f"{line}\n" for line in appended)
    return env_text


def _write_runtime_env_file(env_text: str) -> Path:
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        prefix="civilrides-prod-",
        suffix=".env",
        delete=False,
    ) as handle:
        handle.write(env_text)
        return Path(handle.name)


def _argv_with_env_file(argv: list[str], env_file: Path) -> list[str]:
    updated: list[str] = []
    idx = 0
    replaced = False
    while idx < len(argv):
        arg = argv[idx]
        if arg == "--env-file":
            updated.extend(["--env-file", str(env_file)])
            replaced = True
            idx += 2
            continue
        if arg.startswith("--env-file="):
            updated.append(f"--env-file={env_file}")
            replaced = True
            idx += 1
            continue
        updated.append(arg)
        idx += 1

    if not replaced:
        updated.extend(["--env-file", str(env_file)])
    return updated


def _run_best_effort(command: list[str]) -> None:
    printable = " ".join(command)
    print(f"→ Docker cleanup: {printable}")
    try:
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as exc:
        print(f"→ Warning: cleanup command failed with exit code {exc.returncode}: {printable}", file=sys.stderr)


def _post_prod_command(command: str, _: dict[str, str]) -> None:
    if command not in {"deploy", "build", "rebuild", "rebuild-all"}:
        return

    print("→ Running post-deploy Docker cleanup to keep Docker storage healthy")
    _run_best_effort(["docker", "builder", "prune", "-a", "-f", "--filter", "until=24h"])
    _run_best_effort(["docker", "image", "prune", "-a", "-f", "--filter", "until=168h"])
    _run_best_effort(["docker", "container", "prune", "-f", "--filter", "until=168h"])


def main(argv: list[str]) -> int:
    if not (REPO_ROOT / "civil" / "docker-compose.yml").is_file():
        print("Error: expected to run from the repo root (missing civil/docker-compose.yml)", file=sys.stderr)
        return 2

    from docker_helper import run_helper

    source_env_file, source_env_exists = _select_source_env_file(argv)
    runtime_env_file: Path | None = None
    patched_argv = list(argv)
    original_sys_argv = sys.argv[:]

    if source_env_file is None or source_env_exists:
        runtime_env_file = _write_runtime_env_file(_build_branded_env_text(source_env_file))
        patched_argv = _argv_with_env_file(argv, runtime_env_file)

    try:
        sys.argv = [original_sys_argv[0], *patched_argv]
        run_helper(
            default_env_candidates=list(DEFAULT_ENV_CANDIDATES),
            # Production default project (existing stack with static ports).
            # Override via COMPOSE_PROJECT_NAME if needed.
            default_project_name="civil_prod",
            # Preserve infra (postgres/redis/minio) and only rebuild/restart app.
            default_command="deploy",
            post_command=_post_prod_command,
        )
    finally:
        sys.argv = original_sys_argv
        if runtime_env_file is not None:
            runtime_env_file.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
