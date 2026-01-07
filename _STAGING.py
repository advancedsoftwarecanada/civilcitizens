#!/usr/bin/env python3
"""Civil Citizens staging helper (full Docker stack).

Keeps the legacy Docker workflow available (rebuild/up/infra-up/etc).
For fast iteration on dev.civilcitizens.ca, use `./_DEV.py` instead.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Mapping

from docker_helper import run_helper

ROOT_DIR = Path(__file__).resolve().parent
CIVIL_DIR = ROOT_DIR / "civil"


def run_admin_bootstrap(command: str, overrides: Mapping[str, str]) -> None:
    if command not in {"up", "rebuild", "rebuild-all", "infra-up"}:
        return

    env = os.environ.copy()
    env.update(overrides)
    env.setdefault(
        "DATABASE_URL",
        f"postgresql://postgres:postgres@localhost:{env.get('POSTGRES_HOST_PORT', '5432')}/civil",
    )

    pnpm_bin = env.get("PNPM_BIN", "pnpm")
    nvm_node20 = Path.home() / ".nvm/versions/node/v20.19.6/bin"
    if nvm_node20.exists():
        env["PATH"] = f"{nvm_node20}:{env.get('PATH','')}"

    bootstrap_cmd = [
        pnpm_bin,
        "--filter",
        "@civil/api",
        "exec",
        "tsx",
        "scripts/bootstrap-admin.ts",
    ]

    print("-> Running admin bootstrap check...")
    try:
        subprocess.run(bootstrap_cmd, check=True, cwd=CIVIL_DIR, env=env)
    except FileNotFoundError:
        print("-> pnpm not found; skipping admin bootstrap.")
    except subprocess.CalledProcessError:
        print("-> Admin bootstrap failed. See output above for details.")
        raise


if __name__ == "__main__":
    extra_files = []
    override_file = CIVIL_DIR / "docker-compose.override.yml"
    if override_file.exists():
        extra_files.append(override_file)

    run_helper(
        default_env_candidates=[Path(".env.dev"), Path(".env")],
        default_project_name="civil_dev",
        default_command="rebuild",
        post_command=run_admin_bootstrap,
        extra_compose_files=extra_files,
    )
