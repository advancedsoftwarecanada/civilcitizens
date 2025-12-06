#!/usr/bin/env python3
"""Helper entrypoint for dev Civil Citizens stack."""
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
    bootstrap_cmd = [
        "pnpm",
        "--filter",
        "@civil/api",
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
    run_helper(
        default_env_candidates=[Path(".env.dev"), Path(".env")],
        default_project_name="civil_dev",
        default_command="rebuild",
        post_command=run_admin_bootstrap,
    )
