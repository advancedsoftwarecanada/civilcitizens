#!/usr/bin/env python3
"""Civil production runner (run on the server).

This script assumes you're already SSH'd into the production machine.
It does NOT rsync/upload code.

Default behavior is to rebuild and restart the production stack using docker compose.

Usage:
  python3 _PROD.py                  # rebuild (down + build + up -d)
  python3 _PROD.py status           # docker compose ps
  python3 _PROD.py logs             # follow logs
  python3 _PROD.py down             # docker compose down
  python3 _PROD.py rebuild-all      # down -v + build --no-cache + up -d

Env:
  - Pass `--env-file .env.production` (or `.env.production.googlecloud`) to control settings.
  - Or set `COMPOSE_PROJECT_NAME` to override the default project name.
"""

from __future__ import annotations

import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent


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
        default_project_name="civil_prod",
        default_command="rebuild",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
