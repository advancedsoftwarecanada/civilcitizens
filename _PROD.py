#!/usr/bin/env python3
"""Helper entrypoint for prod Civil Citizens stack."""
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

    # Prefer explicit pnpm override, else try nvm node 20 bin, else fall back to pnpm on PATH.
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
    run_helper(
        default_env_candidates=[Path(".env.production"), Path(".env"), Path(".env.prod")],
        default_project_name="civil_prod",
        default_command="rebuild",
        post_command=run_admin_bootstrap,
    )
