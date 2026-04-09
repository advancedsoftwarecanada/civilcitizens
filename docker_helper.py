#!/usr/bin/env python3
"""Docker helper for the Civil Citizens stack."""
from __future__ import annotations

import argparse
import grp
import os
import pwd
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from collections import deque
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


def _docker_info_error() -> Optional[str]:
    try:
        subprocess.run(
            ["docker", "info"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        return None
    except subprocess.CalledProcessError as exc:
        return (exc.stderr or "").strip()
    except OSError as exc:
        return str(exc)


def _user_effectively_in_group(group_name: str) -> bool:
    try:
        target_group = grp.getgrnam(group_name)
    except KeyError:
        return False

    if target_group.gr_gid in os.getgroups() or os.getgid() == target_group.gr_gid:
        return True

    try:
        username = pwd.getpwuid(os.getuid()).pw_name
    except KeyError:
        return False

    return username in target_group.gr_mem


def maybe_reexec_with_docker_group() -> None:
    if os.name != "posix" or os.environ.get("CIVIL_DOCKER_GROUP_REEXEC") == "1":
        return
    if shutil.which("sg") is None:
        return

    docker_error = _docker_info_error()
    if not docker_error:
        return
    if "permission denied" not in docker_error.lower() or "docker.sock" not in docker_error.lower():
        return
    if not _user_effectively_in_group("docker"):
        return

    print("→ Docker access requires refreshing this shell's docker group; re-running via 'sg docker'")
    rerun_command = shlex.join([sys.executable, *sys.argv])
    env = os.environ.copy()
    env["CIVIL_DOCKER_GROUP_REEXEC"] = "1"
    os.execvpe("sg", ["sg", "docker", "-c", rerun_command], env)


def try_get_docker_root_dir() -> Optional[Path]:
    """Best-effort lookup of Docker's data-root (Linux hosts).

    On Docker Desktop (macOS/Windows), this may not be meaningful, but on
    production Linux servers it helps us warn about low disk space early.
    """

    try:
        raw = subprocess.check_output(
            ["docker", "info", "--format", "{{.DockerRootDir}}"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        return None

    if not raw:
        return None
    try:
        return Path(raw)
    except Exception:
        return None


def warn_if_low_disk_space(command: str) -> None:
    """Print a warning if disk space is likely too low for Docker builds."""

    if command not in {"deploy", "build", "rebuild", "rebuild-all"}:
        return

    # Warn at ~6GB free. This is a heuristic; Node/Next builds can spike.
    min_free_bytes = 6 * 1024 * 1024 * 1024

    docker_root = try_get_docker_root_dir()
    paths_to_check: list[Path] = []
    if docker_root:
        paths_to_check.append(docker_root)
    # Fallback: check the filesystem containing the repo root.
    paths_to_check.append(ROOT_DIR)

    checked: set[Path] = set()
    for path in paths_to_check:
        if path in checked:
            continue
        checked.add(path)
        try:
            usage = shutil.disk_usage(path)
        except Exception:
            continue

        if usage.free < min_free_bytes:
            free_gb = usage.free / (1024**3)
            location = str(path)
            print(
                f"→ Warning: low disk space (~{free_gb:.1f} GB free) at {location}. "
                "If builds fail with 'no space left on device', run: python3 _PROD.py prune-build-cache",
                file=sys.stderr,
            )
            # One warning is enough.
            return


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
    """Run docker compose while streaming output, but keep a tail for error detection.

    We purposefully stream logs to the console (important during builds), but also
    retain the last ~200 lines so we can detect common failures like ENOSPC and
    provide actionable remediation.
    """

    env = os.environ.copy()
    env.update(overrides)
    cmd = base_cmd + extra_args

    # Use a single combined output stream to preserve ordering.
    proc = subprocess.Popen(
        cmd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
    )

    tail: deque[str] = deque(maxlen=200)
    assert proc.stdout is not None
    for line in proc.stdout:
        sys.stdout.write(line)
        tail.append(line)
    proc.stdout.close()
    returncode = proc.wait()
    if returncode != 0:
        raise ComposeCommandError(returncode, "".join(tail))


class ComposeCommandError(RuntimeError):
    def __init__(self, returncode: int, tail: str):
        super().__init__(f"compose failed with exit code {returncode}")
        self.returncode = returncode
        self.tail = tail


def is_no_space_error(output: str) -> bool:
    lowered = output.lower()
    return (
        "no space left on device" in lowered
        or "resourceexhausted" in lowered
        or "enospc" in lowered
    )


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


def command_prune_docker(_: list[str], __: Mapping[str, str]) -> None:
    """Prune common Docker space hogs (safe: does not remove volumes).

    - Removes BuildKit build cache
    - Removes stopped containers
    - Removes unused images
    - Removes unused networks
    """

    subprocess.run(["docker", "builder", "prune", "-a", "-f"], check=True)
    subprocess.run(["docker", "container", "prune", "-f"], check=True)
    subprocess.run(["docker", "image", "prune", "-a", "-f"], check=True)
    subprocess.run(["docker", "network", "prune", "-f"], check=True)


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


def command_deploy(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    """Deploy app updates without tearing down infra.

    - Ensures infra is up (postgres/redis/minio)
    - Builds application images
    - Restarts app services with the new images

    This avoids port conflicts and preserves existing DB/Redis containers.
    """

    # Bring up infra if it's not already running.
    run_compose(compose_cmd, ["--profile", "infra", "up", "-d"], overrides)

    # Compose validates `depends_on` across enabled services. Our app services
    # depend on infra services (postgres/redis), so we enable both profiles here,
    # but only build the app images.
    run_compose(
        compose_cmd,
        ["--profile", "infra", "--profile", "app", "build", "api", "web", "worker", "push", "meeting-rtc"],
        overrides,
    )

    # Recreate app containers so new images take effect, without restarting infra.
    run_compose(
        compose_cmd,
        [
            "--profile",
            "infra",
            "--profile",
            "app",
            "up",
            "-d",
            "--force-recreate",
            "--remove-orphans",
            "--no-deps",
            "api",
            "web",
            "worker",
            "push",
            "meeting-rtc",
            "nginx",
        ],
        overrides,
    )


def command_infra_up(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    run_compose(compose_cmd, ["--profile", "infra", "up", "-d"], overrides)


def command_shadow_infra_up(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    run_compose(
        compose_cmd,
        ["--profile", "shadow-infra", "up", "-d", "postgres-gis-shadow"],
        overrides,
    )


def command_shadow_down(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    run_compose(compose_cmd, ["rm", "-sf", "postgres-gis-shadow"], overrides)


def command_maps_up(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    run_compose(
        compose_cmd,
        ["--profile", "maps-core", "up", "-d", "tileserver-gl", "osrm"],
        overrides,
    )


def command_maps_down(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    run_compose(compose_cmd, ["rm", "-sf", "tileserver-gl", "osrm"], overrides)


def command_nominatim_up(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    run_compose(
        compose_cmd,
        ["--profile", "nominatim", "up", "-d", "--build", "nominatim"],
        overrides,
    )


def command_nominatim_down(compose_cmd: list[str], overrides: Mapping[str, str]) -> None:
    run_compose(compose_cmd, ["rm", "-sf", "nominatim"], overrides)


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
            "deploy",
            "build",
            "up",
            "infra-up",
            "maps-up",
            "maps-down",
            "nominatim-up",
            "nominatim-down",
            "shadow-infra-up",
            "shadow-down",
            "down",
            "down-all",
            "status",
            "logs",
            "rebuild",
            "rebuild-all",
            "prune-build-cache",
            "prune-docker",
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
    pre_command: Optional[Callable[[str, Mapping[str, str]], None]] = None,
    post_command: Optional[Callable[[str, Mapping[str, str]], None]] = None,
    extra_compose_files: Iterable[Path] = [],
) -> None:
    ensure_docker()
    maybe_reexec_with_docker_group()
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

    prisma_env_commands = {"deploy", "build", "up", "infra-up", "rebuild", "rebuild-all"}
    if args.command in prisma_env_commands:
        ensure_prisma_env(overrides)

    command_map = {
        "deploy": command_deploy,
        "build": lambda c, o: command_build(c, o, no_cache=False),
        "up": command_up,
        "infra-up": command_infra_up,
        "maps-up": command_maps_up,
        "maps-down": command_maps_down,
        "nominatim-up": command_nominatim_up,
        "nominatim-down": command_nominatim_down,
        "shadow-infra-up": command_shadow_infra_up,
        "shadow-down": command_shadow_down,
        "down": command_down,
        "down-all": command_down_all,
        "status": command_status,
        "logs": command_logs,
        "rebuild": command_rebuild,
        "rebuild-all": command_rebuild_all,
        "prune-build-cache": command_prune_build_cache,
        "prune-docker": command_prune_docker,
    }

    handler = command_map[args.command]
    warn_if_low_disk_space(args.command)
    did_prune_cache = False
    did_prune_full = False
    try:
        if pre_command:
            try:
                pre_command(args.command, dict(overrides))
            except subprocess.CalledProcessError as exc:
                print(f"✖ Pre-build check failed (exit code {exc.returncode})", file=sys.stderr)
                sys.exit(exc.returncode)

        while True:
            try:
                handler(compose_cmd, overrides)
                if post_command:
                    post_command(args.command, dict(overrides))
                print("✔ Done")
                break
            except ComposeCommandError as exc:
                print(f"✖ Command failed (exit code {exc.returncode})", file=sys.stderr)

                if args.command in {"deploy", "build", "rebuild", "rebuild-all"} and is_no_space_error(exc.tail):
                    if not did_prune_cache:
                        did_prune_cache = True
                        print(
                            "→ Detected 'no space left on device'. Pruning Docker build cache and retrying...",
                            file=sys.stderr,
                        )
                        command_prune_build_cache([], {})
                        continue

                    if not did_prune_full:
                        did_prune_full = True
                        print(
                            "→ Still out of space. Pruning unused images/containers (no volumes) and retrying...",
                            file=sys.stderr,
                        )
                        command_prune_docker([], {})
                        continue

                    print(
                        "→ Still out of space after pruning. Next steps:\n"
                        "  - On Docker Desktop (macOS/Windows), increase the Disk image size in Settings → Resources\n"
                        "  - Or move Docker's Disk image to a larger drive in Docker Desktop settings",
                        file=sys.stderr,
                    )

                if args.command in {"deploy", "build", "rebuild", "rebuild-all"}:
                    print(
                        "→ Tip: if the output mentions 'no space left on device' / 'ResourceExhausted', "
                        "run: python3 _PROD.py prune-build-cache (or prune-docker)",
                        file=sys.stderr,
                    )
                sys.exit(exc.returncode)
    except KeyboardInterrupt:
        print("\nAborted", file=sys.stderr)
        sys.exit(1)
