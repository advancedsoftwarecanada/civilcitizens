#!/usr/bin/env python3
"""Integration test helper for Civil Citizens.

Starts test infra (Postgres/Redis), applies optional SQL fixtures from ./tests,
then runs @civil/api Vitest suite. Stops containers on completion.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Iterable, Mapping, Optional

from docker_helper import build_compose_base, detect_env_file, normalize_candidates, parse_env_file, describe_env_file

ROOT_DIR = Path(__file__).resolve().parent
CIVIL_DIR = ROOT_DIR / "civil"
TESTS_DIR = ROOT_DIR / "tests"


def run(cmd: list[str], *, env: Mapping[str, str], cwd: Optional[Path] = None, input_bytes: bytes | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, cwd=cwd or CIVIL_DIR, env=env, input=input_bytes, capture_output=False)


def newest_fixture(prefix: str) -> Optional[Path]:
    if not TESTS_DIR.is_dir():
        return None
    candidates = sorted(TESTS_DIR.glob(f"{prefix}_*.sql"), key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def apply_sql_fixture(label: str, compose_cmd: list[str], env: Mapping[str, str], db_name: str) -> None:
    if env.get("SKIP_SQL_FIXTURES") == "1":
        print(f"→ Skipping {label} fixture (SKIP_SQL_FIXTURES=1)")
        return

    path = newest_fixture(label)
    if not path:
        print(f"→ No {label} fixture found; skipping")
        return
    print(f"→ Applying {label} fixture: {path.name}")
    # Truncate all public tables to avoid key collisions when replaying dumps
    truncate_stmt = "DO $$ DECLARE r RECORD; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE'; END LOOP; END $$;"
    run(
        compose_cmd + ["exec", "-T", "postgres", "psql", "-U", "postgres", "-d", db_name, "-c", truncate_stmt],
        env=env,
    )

    sql = path.read_bytes()
    run(
        compose_cmd + ["exec", "-T", "postgres", "psql", "-U", "postgres", "-d", db_name],
        env=env,
        input_bytes=sql,
    )


def main() -> None:
    env_candidates: Iterable[Path | str] = [Path(".env.test"), Path(".env.dev"), Path(".env")]
    env_file = detect_env_file(None, normalize_candidates(env_candidates))
    env_file_vars = parse_env_file(env_file) if env_file else {}

    project_name = os.environ.get("COMPOSE_PROJECT_NAME", "civil_test")
    compose_cmd = build_compose_base(project_name, env_file)
    env: dict[str, str] = os.environ.copy()
    # Env file vars act as defaults; allow existing environment to win (for port overrides)
    for key, value in env_file_vars.items():
        if key not in env:
            env[key] = value
    env["COMPOSE_PROJECT_NAME"] = project_name
    env.setdefault("API_SKIP_LISTEN", "1")
    env.setdefault("JWT_SECRET", "test_secret")
    # Default to non-dev ports; override via env to avoid binding conflicts
    env.setdefault("POSTGRES_HOST_PORT", "6544")
    env.setdefault("REDIS_HOST_PORT", "6385")
    env.setdefault("MINIO_HOST_PORT", "9206")
    env.setdefault("MINIO_CONSOLE_HOST_PORT", "9207")

    db_name = env.get("POSTGRES_DB", "civil")

    print(f"→ Using env file {describe_env_file(env_file)}")
    print(f"→ Starting test infra for project '{project_name}'")
    run(compose_cmd + ["--profile", "infra", "up", "-d"], env=env)

    try:
        print("→ Syncing schema (db push --force-reset)")
        # Use db push with --force-reset to guarantee a fresh schema in test containers
        run(["pnpm", "--filter", "@civil/db", "prisma", "db", "push", "--force-reset"], env=env)

        print("→ Loading SQL fixtures (optional)")
        apply_sql_fixture("geodata", compose_cmd, env, db_name)
        apply_sql_fixture("communities", compose_cmd, env, db_name)

        print("→ Running API tests")
        result = subprocess.run(
            ["pnpm", "--filter", "@civil/api", "test"],
            cwd=CIVIL_DIR,
            env=env,
            text=True,
            capture_output=True,
        )
        print(result.stdout)
        if result.stderr:
            print(result.stderr)
        if result.returncode == 0:
            print("→ Test summary: ALL PASSED")
        else:
            print(f"→ Test summary: FAILED (exit {result.returncode})")
            raise subprocess.CalledProcessError(result.returncode, result.args)
    finally:
        print("→ Stopping test infra")
        run(compose_cmd + ["down", "--remove-orphans"], env=env)


if __name__ == "__main__":
    main()
