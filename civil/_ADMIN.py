#!/usr/bin/env python3
r"""
Civil Admin shortcuts for local development and Docker workflows.

Examples:
  python _ADMIN.py help
  python _ADMIN.py infra up
  python _ADMIN.py infra down
  python _ADMIN.py dev server --install
  python _ADMIN.py dev client --install
  python _ADMIN.py dev all --force
  python _ADMIN.py docker up
  python _ADMIN.py docker down
  python _ADMIN.py status
    python _ADMIN.py deploy

Notes:
 - Uses pnpm workspaces; run with --install once to bootstrap deps.
 - Docker Compose profiles: infra (postgres, redis), app (api, web, worker, nginx)
 - API on :3000, Web on :3001
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import shutil
import socket
import time
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
COMPOSE_FILE = os.path.join(ROOT, "docker-compose.yml")
OVERRIDE_FILE = os.path.join(ROOT, "docker-compose.override.yml")

PORT_API = 3000
PORT_WEB = 3001

PNPM_CMD: str | None = None


def resolve_pnpm_command() -> str:
    global PNPM_CMD
    if PNPM_CMD:
        return PNPM_CMD
    if shutil.which("pnpm"):
        PNPM_CMD = "pnpm"
        return PNPM_CMD
    if shutil.which("corepack"):
        PNPM_CMD = "corepack pnpm"
        print("Info: pnpm not found on PATH; falling back to 'corepack pnpm'.")
        return PNPM_CMD
    print("Error: required tool not found on PATH: pnpm")
    print("Hint: enable Corepack (`corepack enable`) or install pnpm globally.")
    sys.exit(127)


def expand_command(cmd: str) -> str:
    stripped = cmd.lstrip()
    if not stripped.startswith("pnpm"):
        return cmd
    if len(stripped) > 4 and stripped[4] not in {" ", "\t", "\n"}:
        return cmd
    leading = cmd[: len(cmd) - len(stripped)]
    resolved = resolve_pnpm_command()
    rest = stripped[4:]
    return f"{leading}{resolved}{rest}"


def run(cmd: str, cwd: str | None = None) -> int:
    expanded = expand_command(cmd)
    print(f"\n$ {expanded}")
    return subprocess.call(expanded, cwd=cwd, shell=True)


def popen(cmd: str, cwd: str | None = None) -> subprocess.Popen:
    expanded = expand_command(cmd)
    print(f"\n$ {expanded}")
    return subprocess.Popen(expanded, cwd=cwd, shell=True)


def require_tool(name: str, hint: str | None = None) -> None:
    if shutil.which(name):
        return
    print(f"Error: required tool not found on PATH: {name}")
    if hint:
        print(hint)
    sys.exit(127)


def port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.2)
        return s.connect_ex((host, port)) == 0


def kill_port_hint(port: int) -> None:
    print(
        f"Port {port} appears busy. Free it or change the port.\n"
        "Windows:   netstat -ano | findstr :{port}\n"
        "           taskkill /PID <PID> /F\n"
        "macOS:     lsof -ti tcp:{port} | xargs kill -9\n"
        "Linux:     fuser -k {port}/tcp\n".replace("{port}", str(port))
    )


def find_pids_on_port(port: int) -> list[int]:
    try:
        if os.name == 'nt':
            result = subprocess.run('netstat -ano', capture_output=True, text=True, shell=True)
            pids: set[int] = set()
            if result.returncode == 0:
                for line in result.stdout.splitlines():
                    if f':{port} ' in line and 'LISTENING' in line:
                        parts = re.split(r"\s+", line.strip())
                        if parts:
                            try:
                                pids.add(int(parts[-1]))
                            except ValueError:
                                pass
            return list(pids)
        else:
            result = subprocess.run(["bash", "-lc", f"lsof -ti tcp:{port}"], capture_output=True, text=True)
            pids: list[int] = []
            if result.returncode == 0 and result.stdout.strip():
                for tok in result.stdout.strip().split():
                    try:
                        pids.append(int(tok))
                    except ValueError:
                        pass
            return pids
    except Exception:
        return []


def kill_pids(pids: list[int]) -> None:
    if not pids:
        return
    if os.name == 'nt':
        for pid in pids:
            subprocess.run(f"taskkill /PID {pid} /F", shell=True)
    else:
        for pid in pids:
            subprocess.run(["bash", "-lc", f"kill -9 {pid}"], capture_output=True)


def kill_port(port: int) -> None:
    pids = find_pids_on_port(port)
    if not pids:
        return
    print(f"Killing PIDs on port {port}: {pids}")
    kill_pids(pids)
    time.sleep(0.5)


def compose_file_args() -> str:
    parts = [f'-f "{COMPOSE_FILE}"']
    if os.path.exists(OVERRIDE_FILE):
        parts.append(f'-f "{OVERRIDE_FILE}"')
    return " ".join(parts)


def run_prisma_db_push(compose_args: str, *, bootstrap: bool = True) -> int:
    """Execute `prisma db push` inside the API service container."""
    install_step = ""
    if bootstrap:
        install_step = (
            "pnpm config set store-dir /app/.pnpm-store && "
            "pnpm -w i --no-frozen-lockfile && "
        )
    command = (
    f"docker compose {compose_args} --profile infra --profile app run --rm --no-deps "
    "api sh -lc \""
    "corepack enable && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack prepare pnpm@9 --activate && "
    f"{install_step}"
    "pnpm --filter @civil/db prisma db push\""
    )
    return run(command, cwd=ROOT)


def ensure_infra() -> int:
    require_tool(
        "docker",
        "Install Docker: https://docs.docker.com/get-docker/\nAfter install, reopen your shell.",
    )
    files = compose_file_args()
    return run(f"docker compose {files} --profile infra up -d postgres redis", cwd=ROOT)


def cmd_infra(args: argparse.Namespace) -> int:
    if args.action == "up":
        return ensure_infra()
    elif args.action == "down":
        files = compose_file_args()
        return run(f"docker compose {files} down", cwd=ROOT)
    else:
        print("Unknown infra action. Use: up | down")
        return 2


def install_deps() -> int:
    cmd = f"{resolve_pnpm_command()} i"
    return run(cmd, cwd=ROOT)


def cmd_dev_server(args: argparse.Namespace) -> int:
    # Start only infra in Docker; run API locally with hot reload
    code = ensure_infra()
    if code != 0:
        return code
    if args.install:
        code = install_deps()
        if code != 0:
            return code
    if port_in_use(PORT_API, "127.0.0.1"):
        print(f"Warning: port {PORT_API} is already in use.")
        if getattr(args, 'force', False):
            kill_port(PORT_API)
        else:
            kill_port_hint(PORT_API)
            return 1
    return run("pnpm --filter @civil/api dev", cwd=ROOT)


def cmd_dev_client(args: argparse.Namespace) -> int:
    # Web runs locally with hot reload; infra remains in Docker
    if args.install:
        code = install_deps()
        if code != 0:
            return code
    if port_in_use(PORT_WEB, "127.0.0.1"):
        print(f"Warning: port {PORT_WEB} (web) is already in use.")
        if getattr(args, 'force', False):
            kill_port(PORT_WEB)
        else:
            kill_port_hint(PORT_WEB)
            return 1
    return run("pnpm --filter @civil/web dev", cwd=ROOT)


def cmd_dev_all(args: argparse.Namespace) -> int:
    # Run infra in Docker, API & Web locally, both with hot reload
    code = ensure_infra()
    if code != 0:
        return code
    if args.install:
        code = install_deps()
        if code != 0:
            return code
    # Ports
    for port in (PORT_API, PORT_WEB):
        if port_in_use(port, "127.0.0.1"):
            print(f"Warning: port {port} is already in use.")
            if getattr(args, 'force', False):
                kill_port(port)
            else:
                kill_port_hint(port)
                return 1
    procs: list[tuple[str, subprocess.Popen]] = []
    procs.append(("api", popen("pnpm --filter @civil/api dev", cwd=ROOT)))
    procs.append(("web", popen("pnpm --filter @civil/web dev", cwd=ROOT)))

    print("\nAPI:  http://localhost:3000/health  |  Web: http://localhost:3001")
    print("Press Ctrl+C to stop.")
    try:
        exit_code = 0
        for name, p in procs:
            code = p.wait()
            if code != 0:
                print(f"Process '{name}' exited with code {code}")
                exit_code = code
        return exit_code
    except KeyboardInterrupt:
        for name, p in procs:
            print(f"Terminating {name}...")
            try:
                p.terminate()
            except Exception:
                pass
        return 0


def cmd_docker(args: argparse.Namespace) -> int:
    require_tool(
        "docker",
        "Install Docker: https://docs.docker.com/get-docker/\nAfter install, reopen your shell.",
    )
    if args.action == "up":
        return run(
            f"docker compose -f \"{COMPOSE_FILE}\" --profile infra --profile app up -d --build",
            cwd=ROOT,
        )
    elif args.action == "down":
        return run(f"docker compose -f \"{COMPOSE_FILE}\" down", cwd=ROOT)
    else:
        print("Unknown docker action. Use: up | down")
        return 2


def cmd_status(args: argparse.Namespace) -> int:
    print("\n🔍 Checking Civil status...\n")
    api_running = port_in_use(PORT_API)
    web_running = port_in_use(PORT_WEB)
    print(f"📡 API   (:{PORT_API}): {'🟢 RUNNING' if api_running else '🔴 NOT RUNNING'}")
    print(f"🌐 Web   (:{PORT_WEB}): {'🟢 RUNNING' if web_running else '🔴 NOT RUNNING'}")

    print("\n🐳 Docker containers:")
    try:
        result = subprocess.run(
            "docker ps --format \"table {{.Names}}\\t{{.Status}}\\t{{.Ports}}\"",
            capture_output=True,
            text=True,
            shell=True,
            cwd=ROOT,
        )
        if result.returncode == 0 and result.stdout.strip():
            lines = result.stdout.strip().split('\n')
            if len(lines) > 1:
                for line in lines[1:]:
                    if line.strip():
                        print(f"  • {line}")
            else:
                print("  No containers running")
        else:
            print("  No containers running or Docker not available")
    except Exception as e:
        print(f"  Error checking Docker: {e}")

    print("\n💡 Quick actions:")
    if not api_running and not web_running:
        print("  • Bootstrap dev stack: python _ADMIN.py start")
    else:
        print("  • Stop dev stack:      python _ADMIN.py stop")
    if not api_running:
        print("  • Start API:   python _ADMIN.py dev server")
    if not web_running:
        print("  • Start Web:   python _ADMIN.py dev client")
    if api_running and web_running:
        print("  • Both running! Open: http://localhost:3001")
    print()
    return 0


def cmd_deploy(args: argparse.Namespace) -> int:
    """Stop all containers, pull latest repo changes, rebuild and start stack."""
    require_tool(
        "docker",
        "Install Docker: https://docs.docker.com/get-docker/\nAfter install, reopen your shell.",
    )
    print("\n🚀 Deploying Civil (down -> pull -> up --build) ...\n")
    files = f"-f \"{COMPOSE_FILE}\""
    if os.path.exists(OVERRIDE_FILE):
        files += f" -f \"{OVERRIDE_FILE}\""
    # 1) Stop everything
    code = run(f"docker compose {files} --profile infra --profile app down", cwd=ROOT)
    if code != 0:
        print("Warning: compose down returned non-zero; continuing...")
    # 2) Pull latest source
    code = run("git pull --rebase --autostash", cwd=ROOT)
    if code != 0:
        print("Error: git pull failed. Resolve repository state and retry.")
        return code
    # 3) Rebuild and start full stack
    code = run(
        f"docker compose {files} --profile infra --profile app up -d --build",
        cwd=ROOT,
    )
    if code != 0:
        return code
    # 4) Show status
    print()
    cmd_status(args)
    return 0


def cmd_developer(args: argparse.Namespace) -> int:
    """Start/stop the dev stack (hot reload) using docker-compose.override.yml."""
    require_tool(
        "docker",
        "Install Docker: https://docs.docker.com/get-docker/\nAfter install, reopen your shell.",
    )
    action = getattr(args, "action", "up") or "up"
    files = compose_file_args()
    if action == "down":
        # Stop both profiles to fully tear down dev stack
        return run(f"docker compose {files} --profile infra --profile app down", cwd=ROOT)
    # Up: ensure infra, then bring up nginx+web+api with override (dev mode)
    code = run(f"docker compose {files} --profile infra up -d postgres redis", cwd=ROOT)
    if code != 0:
        return code
    return run(
        f"docker compose {files} --profile infra --profile app up -d nginx web api",
        cwd=ROOT,
    )


def cmd_start(args: argparse.Namespace) -> int:
    """One-command bootstrap for the local dev stack (infra + dev containers)."""
    require_tool(
        "docker",
        "Install Docker: https://docs.docker.com/get-docker/\nAfter install, reopen your shell.",
    )
    files = compose_file_args()

    if getattr(args, "clean", False):
        run(f"docker compose {files} --profile infra --profile app down --remove-orphans", cwd=ROOT)

    if not getattr(args, "skip_infra", False):
        code = ensure_infra()
        if code != 0:
            return code
    else:
        if not getattr(args, "quiet", False):
            print("Skipping docker infra start (--skip-infra).")

    if not getattr(args, "skip_migrate", False):
        if not getattr(args, "quiet", False):
            print("Syncing database schema via Prisma (db push)...")
        code = run_prisma_db_push(files, bootstrap=not getattr(args, "no_bootstrap", False))
        if code != 0:
            print("Prisma db push failed. Re-run with --skip-migrate to bypass.")
            return code

    services = ["api", "web"]
    if not getattr(args, "no_nginx", False):
        services.insert(0, "nginx")

    up_cmd = f"docker compose {files} --profile infra --profile app up -d"
    if getattr(args, "build", False):
        up_cmd += " --build"
    if getattr(args, "force_recreate", False):
        up_cmd += " --force-recreate"
    up_cmd += " " + " ".join(services)
    code = run(up_cmd, cwd=ROOT)
    if code != 0:
        return code

    print("\n✅ Dev stack is running.")
    print("  API:  http://localhost:3000/health (proxied via nginx)")
    print("  Web:  http://localhost:3001")
    if not getattr(args, "no_nginx", False):
        print("  Proxy: http://localhost (nginx dev proxy)")
    print("\nUse `python _ADMIN.py stop` to tear things down, or `python _ADMIN.py status` to inspect the stack.\n")
    return 0


def cmd_stop(args: argparse.Namespace) -> int:
    require_tool(
        "docker",
        "Install Docker: https://docs.docker.com/get-docker/\nAfter install, reopen your shell.",
    )
    files = compose_file_args()
    keep_infra = getattr(args, "keep_infra", False)

    if keep_infra:
        code = run(f"docker compose {files} stop nginx web api", cwd=ROOT)
    else:
        down_cmd = f"docker compose {files} --profile infra --profile app down --remove-orphans"
        if getattr(args, "prune_volumes", False):
            down_cmd += " -v"
        code = run(down_cmd, cwd=ROOT)
    if code != 0:
        return code

    if getattr(args, "kill_ports", False):
        kill_port(PORT_API)
        kill_port(PORT_WEB)
    return 0


def print_help() -> None:
    print(
        (
            "Usage:\n"
            "  python _ADMIN.py start [--skip-infra] [--skip-migrate] [--build] [--force-recreate]\n"
            "  python _ADMIN.py stop [--keep-infra] [--kill-ports]\n"
            "  python _ADMIN.py dev [server|client|all] [--install] [--force]\n"
            "  python _ADMIN.py infra up|down\n"
            "  python _ADMIN.py docker up|down\n"
            "  python _ADMIN.py status\n"
            "  python _ADMIN.py deploy\n\n"
            "Notes:\n  --install runs 'pnpm i' once at the repo root.\n"
            "  --force kills anything bound to ports 3000/3001.\n"
        )
    )


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Civil admin shortcuts",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    sub = p.add_subparsers(dest="command")

    pstart = sub.add_parser("start", help="Bootstrap the local dev stack (Docker infra + dev containers)")
    pstart.add_argument("--skip-infra", action="store_true", help="Skip starting Postgres/Redis (expects them to already be running)")
    pstart.add_argument("--skip-migrate", action="store_true", help="Skip Prisma db push during startup")
    pstart.add_argument("--no-bootstrap", action="store_true", help="Skip pnpm install step during Prisma migration helper")
    pstart.add_argument("--build", action="store_true", help="Force docker compose --build for app services")
    pstart.add_argument("--force-recreate", action="store_true", help="Force recreation of containers even if configuration unchanged")
    pstart.add_argument("--no-nginx", action="store_true", help="Do not start nginx dev proxy (access services via ports 3000/3001)")
    pstart.add_argument("--clean", action="store_true", help="Down any existing dev containers before booting")
    pstart.add_argument("--quiet", action="store_true", help="Reduce informational logging during startup")
    pstart.set_defaults(func=cmd_start)

    pstop = sub.add_parser("stop", help="Stop the dev stack started with 'start'")
    pstop.add_argument("--keep-infra", action="store_true", help="Leave Postgres/Redis running; only stop web/api/nginx")
    pstop.add_argument("--kill-ports", action="store_true", help="Kill lingering local processes bound to ports 3000/3001")
    pstop.add_argument("--prune-volumes", action="store_true", help="Also remove docker volumes when tearing down")
    pstop.set_defaults(func=cmd_stop)

    pi = sub.add_parser("infra", help="Manage infra services (Postgres, Redis)")
    pi_sub = pi.add_subparsers(dest="action")
    piu = pi_sub.add_parser("up", help="Start Postgres + Redis (Docker)")
    piu.set_defaults(func=cmd_infra)
    pid = pi_sub.add_parser("down", help="Stop all compose services")
    pid.set_defaults(func=cmd_infra)

    pd = sub.add_parser("dev", help="Run local dev servers with hot reload")
    pd.add_argument("target", nargs="?", choices=["server", "client", "all"], default="server")
    pd.add_argument("--install", action="store_true", help="Run pnpm install before starting")
    pd.add_argument("--force", action="store_true", help="Kill processes on occupied ports")

    pk = sub.add_parser("docker", help="Run full stack in Docker (infra + app)")
    pk_sub = pk.add_subparsers(dest="action")
    pku = pk_sub.add_parser("up", help="Start full stack")
    pku.set_defaults(func=cmd_docker)
    pkd = pk_sub.add_parser("down", help="Stop stack")
    pkd.set_defaults(func=cmd_docker)

    ps = sub.add_parser("status", help="Check status of running processes and services")
    ps.set_defaults(func=cmd_status)

    # deploy: down -> git pull -> up --build -> status
    pdep = sub.add_parser("deploy", help="Stop containers, pull code, rebuild and start stack")
    pdep.set_defaults(func=cmd_deploy)

    # developer: simple alias to run dev stack with hot reload in Docker
    pdev = sub.add_parser("developer", help="Start/stop dev stack (hot reload) using compose override")
    pdev.add_argument("action", nargs="?", choices=["up", "down"], default="up")
    pdev.set_defaults(func=cmd_developer)
    return p


def main(argv: list[str]) -> int:
    if not argv or argv[0] in {"help", "-h", "--help"}:
        print_help()
        return 0
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "dev":
        if args.target == "server":
            return cmd_dev_server(args)
        if args.target == "client":
            return cmd_dev_client(args)
        if args.target == "all":
            return cmd_dev_all(args)
        print_help()
        return 2
    if getattr(args, "func", None):
        return int(args.func(args))
    print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
