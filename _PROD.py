#!/usr/bin/env python3
"""Civil production runner (run on the server).

This script assumes you're already SSH'd into the production machine.
It does NOT rsync/upload code.

Default behavior is to deploy application updates while preserving infra services.
Successful deploy/build commands automatically prune old Docker build cache,
unused images, and stopped containers using age filters.
Deploy/build/rebuild commands also run host-side pnpm preflight checks first
and stop before Docker builds if API or web build checks fail.

Usage:
    python3 _PROD.py                  # deploy + auto-prune old Docker cache/images
  python3 _PROD.py deploy           # same as default
    python3 _PROD.py build            # build images only + auto-prune old Docker cache/images
    python3 _PROD.py maps-up          # start TileServer GL + OSRM against mounted /mnt/osm data
    python3 _PROD.py maps-down        # stop TileServer GL + OSRM services
    python3 _PROD.py nominatim-up     # build/start Nominatim against mounted /mnt/osm data
    python3 _PROD.py nominatim-down   # stop Nominatim service
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
    - Set `CIVIL_SKIP_HOST_PREFLIGHT=1` to bypass the host-side pnpm checks.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent
CIVIL_DIR = REPO_ROOT / "civil"


def _run_checked(command: list[str], *, env: dict[str, str], cwd: Path) -> None:
    printable = " ".join(command)
    print(f"→ Preflight: {printable}")
    subprocess.run(command, check=True, cwd=cwd, env=env)


def _run_container_preflight(*, env: dict[str, str]) -> None:
    print("→ Preflight: host pnpm not found; using disposable Node container")
    docker_command = [
        "docker",
        "run",
        "--rm",
        "-v",
        f"{REPO_ROOT}:/workspace",
        "-w",
        "/workspace/civil",
        "node:20-bookworm",
        "bash",
        "-lc",
        "corepack enable && "
        "pnpm --filter @civil/shared build && "
        "pnpm --filter @civil/db generate && "
        "pnpm --filter @civil/db build && "
        "pnpm --filter @civil/api build && "
        "pnpm --filter @civil/ui build && "
        "pnpm --filter @civil/web build",
    ]
    subprocess.run(docker_command, check=True, cwd=REPO_ROOT, env=env)


def _pre_prod_command(command: str, overrides: dict[str, str]) -> None:
    if command not in {"deploy", "build", "rebuild", "rebuild-all"}:
        return
    if overrides.get("CIVIL_SKIP_HOST_PREFLIGHT") == "1":
        print("→ Skipping host preflight checks because CIVIL_SKIP_HOST_PREFLIGHT=1")
        return

    env = os.environ.copy()
    env.update(overrides)

    if shutil.which("pnpm") is None or shutil.which("node") is None:
        _run_container_preflight(env=env)
        return

    _run_checked(["pnpm", "--filter", "@civil/shared", "build"], env=env, cwd=CIVIL_DIR)
    _run_checked(["pnpm", "--filter", "@civil/db", "generate"], env=env, cwd=CIVIL_DIR)
    _run_checked(["pnpm", "--filter", "@civil/db", "build"], env=env, cwd=CIVIL_DIR)
    _run_checked(["pnpm", "--filter", "@civil/api", "build"], env=env, cwd=CIVIL_DIR)
    _run_checked(["pnpm", "--filter", "@civil/ui", "build"], env=env, cwd=CIVIL_DIR)
    _run_checked(["pnpm", "--filter", "@civil/web", "build"], env=env, cwd=CIVIL_DIR)


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
        print("Error: expected to run from the civilcitizens repo root (missing civil/docker-compose.yml)", file=sys.stderr)
        return 2

    from docker_helper import run_helper

    run_helper(
        default_env_candidates=[
            REPO_ROOT / ".env.production",
            REPO_ROOT / ".env.production.googlecloud",
        ],
        # Production default project (existing stack with static ports).
        # Override via COMPOSE_PROJECT_NAME if needed.
        default_project_name="civil_prod",
        # Preserve infra (postgres/redis/minio) and only rebuild/restart app.
        default_command="deploy",
        pre_command=_pre_prod_command,
        post_command=_post_prod_command,
        extra_compose_files=[REPO_ROOT / "civil" / "docker-compose.maps.yml"],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
