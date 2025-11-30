#!/usr/bin/env python3
"""Helper entrypoint for dev Civil Citizens stack."""
from pathlib import Path

from docker_helper import run_helper

if __name__ == "__main__":
    run_helper(
        default_env_candidates=[Path(".env.dev"), Path(".env")],
        default_project_name="civil_dev",
        default_command="up",
    )
