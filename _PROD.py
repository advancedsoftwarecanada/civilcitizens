#!/usr/bin/env python3
"""Helper entrypoint for prod Civil Citizens stack."""
from pathlib import Path

from docker_helper import run_helper

if __name__ == "__main__":
    run_helper(
        default_env_candidates=[Path(".env.production"), Path(".env"), Path(".env.prod")],
        default_project_name="civil_prod",
        default_command="rebuild-all",
    )
