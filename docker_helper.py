#!/usr/bin/env python3
"""Docker helper for the Civil Citizens stack."""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable, Dict, Iterable, Mapping, Optional, Sequence

ROOT_DIR = Path(__file__).resolve().parent
COMPOSE_DIR = ROOT_DIR / "civil"
DOCKER_COMPOSE_FILE = COMPOSE_DIR / "docker-compose.yml"


def ensure_prisma_env(overrides: Mapping[str, str]) -> None:
    """Ensure Prisma CLI can run locally.

    Prisma loads environment variables from a `.env` file in the schema directory.
    Our docker compose env uses an internal host (`postgres`) which is not reachable
    from the host shell, so we generate a host-friendly DATABASE_URL.
    """

    db_env_path = COMPOSE_DIR / "packages" / "db" / ".env"

    database_url = overrides.get("DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not database_url:
        postgres_host_port = overrides.get("POSTGRES_HOST_PORT") or os.environ.get("POSTGRES_HOST_PORT") or "5432"
        database_url = f"postgresql://postgres:postgres@localhost:{postgres_host_port}/civil"

    try:
        db_env_path.parent.mkdir(parents=True, exist_ok=True)
        db_env_path.write_text(f"DATABASE_URL={database_url}\n")
        print(f"→ Wrote Prisma env {db_env_path.relative_to(ROOT_DIR)}")
    except OSError:
        # Non-fatal: docker compose can still run even if we can't write the file.
        print("→ Warning: unable to write Prisma env file; Prisma CLI may require DATABASE_URL in your shell")


def ensure_docker() -> None:
    if shutil.which("docker") is None:
        print("Error: docker is not installed or not on PATH", file=sys.stderr)
        sys.exit(1)


def detect_env_file(explicit: Optional[str], candidates: Sequence[Path | str]) -> Optional[Path]:
    if explicit:
        candidate = Path(explicit)
        if not candidate.is_absolute():
            candidate = ROOT_DIR / candidate
        if not candidate.is_file():
            print(f"Error: --env-file '{candidate}' does not exist", file=sys.stderr)
            sys.exit(1)
        return candidate

    for candidate in candidates:
        path = candidate if isinstance(candidate, Path) else Path(candidate)
        if not path.is_absolute():
            path = ROOT_DIR / path
        if path.is_file():
            return path
    return None


def parse_env_file(path: Path) -> Dict[str, str]:
    env_map: Dict[str, str] = {}
    try:
        for raw_line in path.read_text().splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export ") :].strip()
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            env_map[key.strip()] = value.strip()
    except OSError:
        pass
    return env_map


def describe_env_file(path: Optional[Path]) -> str:
    if not path:
        return "<none>"
    try:
        relative = path.relative_to(ROOT_DIR)
        return str(relative).replace("\\", "/")
    except ValueError:
        return str(path)


def build_compose_base(project_name: str, env_file: Optional[Path], extra_compose_files: list[Path] = []) -> list[str]:
    cmd = [
        "docker",
        "compose",
        "-p",
        project_name,
        "-f",
        str(DOCKER_COMPOSE_FILE),
    ]
    for f in extra_compose_files:
        cmd += ["-f", str(f)]
    if env_file:
        cmd += ["--env-file", str(env_file)]
    return cmd


def run_compose(base_cmd: list[str], extra_args: list[str], overrides: Mapping[str, str]) -> None:
    env = os.environ.copy()
    env.update(overrides)
    subprocess.run(base_cmd + extra_args, check=True, env=env)


def command_up(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    run_compose(
        compose_cmd,
        ["--profile", "infra", "--profile", "app", "up", "-d"],
        overrides,
    )


def command_build(compose_cmd: list[str], overrides: Mapping[str, str], *, no_cache: bool) -> None:
    args = ["--profile", "infra", "--profile", "app", "build"]
    if no_cache:
        args.append("--no-cache")
    run_compose(compose_cmd, args, overrides)


def command_prune_build_cache(_: list[str], __: Mapping[str, str]) -> None:
    """Prune BuildKit build cache to free space.

    This is intentionally conservative: it does not remove volumes.
    """
    subprocess.run(["docker", "builder", "prune", "-a", "-f"], check=True)


def command_rebuild(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    command_down(compose_cmd, overrides)
    command_build(compose_cmd, overrides, no_cache=False)
    run_compose(
        compose_cmd,
        ["--profile", "infra", "--profile", "app", "up", "-d", "--force-recreate"],
        overrides,
    )


def command_rebuild_all(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    command_down_all(compose_cmd, overrides)
    command_build(compose_cmd, overrides, no_cache=True)
    run_compose(
        compose_cmd,
        ["--profile", "infra", "--profile", "app", "up", "-d", "--force-recreate"],
        overrides,
    )


def command_infra_up(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    run_compose(compose_cmd, ["--profile", "infra", "up", "-d"], overrides)


def command_down(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    run_compose(
        compose_cmd,
        ["--profile", "infra", "--profile", "app", "down", "--remove-orphans"],
        overrides,
    )


def command_down_all(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    run_compose(
        compose_cmd,
        ["--profile", "infra", "--profile", "app", "down", "-v", "--remove-orphans"],
        overrides,
    )


def command_status(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    run_compose(compose_cmd, ["ps"], overrides)


def command_logs(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    run_compose(compose_cmd, ["logs", "-f"], overrides)


def parse_args(default_command: Optional[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Civil Citizens docker helper",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python _DEV.py up --env-file .env.dev\n"
            "  python _PROD.py status\n"
        ),
    )
    parser.add_argument(
        "command",
        nargs="?",
        choices=[
            "build",
            "up",
            "infra-up",
            "down",
            "down-all",
            "status",
            "logs",
            "rebuild",
            "rebuild-all",
            "prune-build-cache",
        ],
        help="Command to execute",
    )
    parser.add_argument("--env-file", dest="env_file", help="Optional env file to pass to docker compose")
    args = parser.parse_args()
    args.command_was_default = False
    if args.command is None:
        if default_command is None:
            parser.error("command is required")
        args.command = default_command
        args.command_was_default = True
    return args


def normalize_candidates(candidates: Iterable[Path | str]) -> list[Path]:
    normalized: list[Path] = []
    for candidate in candidates:
        path = candidate if isinstance(candidate, Path) else Path(candidate)
        if not path.is_absolute():
            path = ROOT_DIR / path
        normalized.append(path)
    return normalized


def run_helper(
    *,
    default_env_candidates: Iterable[Path | str],
    default_project_name: str,
    default_command: Optional[str],
    post_command: Optional[Callable[[str, Mapping[str, str]], None]] = None,
    extra_compose_files: Iterable[Path] = [],
) -> None:
    ensure_docker()
    args = parse_args(default_command)
    os.chdir(ROOT_DIR)
    if args.command_was_default:
        print(f"→ No command provided; defaulting to '{args.command}'")

    env_candidates = normalize_candidates(default_env_candidates)
    env_file = detect_env_file(args.env_file, env_candidates)
    env_file_vars: Dict[str, str] = {}
    env_file_desc = describe_env_file(env_file) if env_file else None
    if env_file:
        env_file_vars = parse_env_file(env_file)
        print(f"→ Using env file {env_file_desc}")
    else:
        print("→ No env file detected; relying on shell environment variables")

    project_name = os.environ.get("COMPOSE_PROJECT_NAME", default_project_name)
    compose_cmd = build_compose_base(project_name, env_file, list(extra_compose_files))

    print(f"→ Using docker compose project '{project_name}'")

    overrides: Dict[str, str] = {"COMPOSE_PROJECT_NAME": project_name}
    overrides.update(env_file_vars)

    env_label = os.environ.get("CIVIL_ENV_LABEL")
    if not env_label:
        if env_file:
            name = env_file.name.lower()
            if "prod" in name:
                env_label = "production"
            elif "stage" in name:
                env_label = "staging"
            else:
                env_label = "development"
        else:
            env_label = os.environ.get("NODE_ENV", "development")

    if env_file_desc:
        overrides.setdefault("CIVIL_ENV_PRIMARY", env_file_desc)
        existing_sources = overrides.get("CIVIL_ENV_FILES")
        overrides["CIVIL_ENV_FILES"] = (
            f"{existing_sources};{env_file_desc}" if existing_sources else env_file_desc
        )
    else:
        overrides.setdefault("CIVIL_ENV_PRIMARY", "")

    if env_label:
        overrides.setdefault("CIVIL_ENV_LABEL", env_label)

    ensure_prisma_env(overrides)

    command_map = {
        "build": lambda c, o: command_build(c, o, no_cache=False),
        "up": command_up,
        "infra-up": command_infra_up,
        "down": command_down,
        "down-all": command_down_all,
        "status": command_status,
        "logs": command_logs,
        "rebuild": command_rebuild,
        "rebuild-all": command_rebuild_all,
        "prune-build-cache": command_prune_build_cache,
    }

    handler = command_map[args.command]
    try:
        handler(compose_cmd, overrides)
        if post_command:
            post_command(args.command, dict(overrides))
        print("✔ Done")
    except subprocess.CalledProcessError as exc:
        print(f"✖ Command failed (exit code {exc.returncode})", file=sys.stderr)
        sys.exit(exc.returncode)
    except KeyboardInterrupt:
        print("\nAborted", file=sys.stderr)
        sys.exit(1)
