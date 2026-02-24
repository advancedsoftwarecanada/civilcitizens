#!/usr/bin/env python3
"""Civil Citizens DEV process manager.

Goal: fast iteration without Docker rebuild loops.

This manages on-host dev processes behind the CybertronDev nginx proxy:
- dev.civilcitizens.ca -> nginx_mariadb_redis -> host:3900 -> CybertronDev nginx
- /      -> Next dev server (host :33101 by default)
- /api/  -> API dev server (host :3012 by default)
- /media -> MinIO in CybertronDev

Commands:
  _DEV.py               # restart (stop + start)
  _DEV.py start         # start detached
  _DEV.py stop          # stop detached
  _DEV.py status        # show status
  _DEV.py logs [N]      # tail logs (default 100)

Managed processes:
- web    (@civil/web dev)
- api    (@civil/api dev)
- worker (@civil/worker dev)
"""

from __future__ import annotations

import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent
CIVIL_DIR = REPO_ROOT / "civil"
CYBERTRON_COMPOSE = Path("/home/andre/CybertronDev/docker-compose.yml")

WEB_PORT = int(os.environ.get("CIVIL_WEB_PORT", "33101"))
# NOTE: In WSL2 + Docker Desktop, some ports can get mapped unexpectedly when
# accessed from containers via host.docker.internal. Defaulting away from 3002
# avoids a collision observed in practice.
API_PORT = int(os.environ.get("CIVIL_API_PORT", "3012"))

CYBERTRON_POSTGRES_PORT = int(os.environ.get("CYBERTRON_POSTGRES_PORT", "5542"))
CYBERTRON_REDIS_PORT = int(os.environ.get("CYBERTRON_REDIS_PORT", "6579"))
CYBERTRON_MINIO_PORT = int(os.environ.get("CYBERTRON_MINIO_PORT", "9102"))

WEB_PID_FILE = Path("/tmp/civil-dev-web.pid")
API_PID_FILE = Path("/tmp/civil-dev-api.pid")
WORKER_PID_FILE = Path("/tmp/civil-dev-worker.pid")

WEB_LOG = Path("/tmp/civil-web.log")
API_LOG = Path("/tmp/civil-api.log")
WORKER_LOG = Path("/tmp/civil-worker.log")


_ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


def _strip_ansi_and_controls(text: str) -> str:
    text = text.replace("\x1bc", "")
    text = text.replace("\x1b", "")
    return _ANSI_RE.sub("", text)


def _port_open(host: str, port: int, timeout_s: float = 0.25) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout_s):
            return True
    except OSError:
        return False


def _read_pid(pid_file: Path) -> int | None:
    try:
        raw = pid_file.read_text(encoding="utf-8").strip()
        return int(raw) if raw else None
    except Exception:
        return None


def _pid_is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _cmdline(pid: int) -> str:
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
        parts = [p.decode("utf-8", errors="replace") for p in raw.split(b"\x00") if p]
        return " ".join(parts)
    except Exception:
        return ""


def _is_repo_dev_process(pid: int) -> bool:
    cmd = _cmdline(pid)
    if not cmd:
        return False

    if str(REPO_ROOT) in cmd:
        return True

    # Heuristics for pnpm/next/tsx started from this repo
    if "next" in cmd and "dev" in cmd and "@civil/web" in cmd:
        return True
    if "tsx" in cmd and "watch" in cmd and "apps/api" in cmd:
        return True
    if "tsx" in cmd and "watch" in cmd and "apps/worker" in cmd:
        return True
    if "concurrently" in cmd and "@civil/api" in cmd:
        return True

    return False


def _pids_listening_on_port(port: int) -> set[int]:
    try:
        out = subprocess.check_output(["ss", "-ltnp"], text=True, stderr=subprocess.DEVNULL)
    except Exception:
        return set()

    pids: set[int] = set()
    for line in out.splitlines():
        if f":{port} " not in line and not line.rstrip().endswith(f":{port}"):
            continue
        idx = 0
        while True:
            idx = line.find("pid=", idx)
            if idx == -1:
                break
            idx += 4
            num = ""
            while idx < len(line) and line[idx].isdigit():
                num += line[idx]
                idx += 1
            if num:
                try:
                    pids.add(int(num))
                except ValueError:
                    pass
    return pids


def _kill_process_group(pid: int, *, timeout_s: float = 6.0) -> bool:
    try:
        pgid = os.getpgid(pid)
    except OSError:
        return True

    try:
        os.killpg(pgid, signal.SIGTERM)
    except OSError:
        return True

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if not _pid_is_alive(pid):
            return True
        time.sleep(0.1)

    try:
        os.killpg(pgid, signal.SIGKILL)
    except OSError:
        return True

    deadline = time.time() + 2.0
    while time.time() < deadline:
        if not _pid_is_alive(pid):
            return True
        time.sleep(0.1)
    return not _pid_is_alive(pid)


def _tail(path: Path, lines: int) -> str:
    try:
        data = path.read_text(encoding="utf-8", errors="replace").splitlines()
        return _strip_ansi_and_controls("\n".join(data[-lines:]))
    except FileNotFoundError:
        return f"(missing: {path})"


def _load_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    env: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k:
            env[k] = v
    return env


def _spawn_detached(cmd: list[str], *, cwd: Path, pid_file: Path, log_file: Path, env: dict[str, str]) -> None:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with log_file.open("ab", buffering=0) as out:
        proc = subprocess.Popen(
            cmd,
            cwd=str(cwd),
            stdin=subprocess.DEVNULL,
            stdout=out,
            stderr=out,
            start_new_session=True,
            env=env,
        )
    pid_file.write_text(str(proc.pid), encoding="utf-8")


def _ensure_cybertron_up() -> None:
    docker = shutil.which("docker")
    if not docker:
        raise RuntimeError("docker not found on PATH")
    if not CYBERTRON_COMPOSE.exists():
        raise RuntimeError(f"Missing CybertronDev compose at {CYBERTRON_COMPOSE}")

    subprocess.run(
        [
            docker,
            "compose",
            "-p",
            "cybertron_dev",
            "-f",
            str(CYBERTRON_COMPOSE),
            "up",
            "-d",
        ],
        check=True,
        cwd=str(REPO_ROOT),
    )


def _ensure_civil_db_role_and_db() -> None:
    docker = shutil.which("docker")
    if not docker:
        return

        sql = r"""
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres LOGIN PASSWORD 'postgres';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'civil') THEN
    CREATE DATABASE civil OWNER postgres;
  END IF;
END $$;

ALTER DATABASE civil OWNER TO postgres;
GRANT ALL PRIVILEGES ON DATABASE civil TO postgres;

\\connect civil

ALTER SCHEMA public OWNER TO postgres;
GRANT USAGE, CREATE ON SCHEMA public TO postgres;
"""

    # If this fails (permissions, container name change), dev can still proceed if DB already exists.
    try:
        subprocess.run(
            [
                docker,
                "exec",
                "-i",
                "cybertron_dev-postgres-1",
                "psql",
                "-U",
                "mmo",
                "-d",
                "postgres",
            ],
            input=sql.encode("utf-8"),
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def _apply_prisma_migrations(pnpm: str, env: dict[str, str]) -> None:
    # Keep dev DB schema in sync on every start.
    subprocess.run(
        [pnpm, "--filter", "@civil/db", "prisma", "migrate", "deploy"],
        cwd=str(CIVIL_DIR),
        env=env,
        check=True,
    )


def stop() -> int:
    stopped_any = False

    for label, pid_file in (("web", WEB_PID_FILE), ("api", API_PID_FILE), ("worker", WORKER_PID_FILE)):
        pid = _read_pid(pid_file)
        if pid and _pid_is_alive(pid):
            print(f"⏹ Stopping {label} (pid {pid})")
            _kill_process_group(pid)
            stopped_any = True
        try:
            pid_file.unlink(missing_ok=True)
        except Exception:
            pass

    for port, label in ((WEB_PORT, "web"), (API_PORT, "api")):
        for pid in sorted(_pids_listening_on_port(port)):
            if not _pid_is_alive(pid):
                continue
            if not _is_repo_dev_process(pid):
                continue
            print(f"⏹ Stopping {label} listener on port {port} (pid {pid})")
            _kill_process_group(pid)
            stopped_any = True

    if not stopped_any:
        print("✅ Nothing to stop")
    return 0


def start() -> int:
    pnpm = shutil.which("pnpm")
    if not pnpm:
        print("❌ pnpm not found on PATH.")
        return 2

    # Prefer nvm node 20 bin if present (avoids pnpm shim issues)
    env = os.environ.copy()
    nvm_node20 = Path.home() / ".nvm/versions/node/v20.19.6/bin"
    if nvm_node20.exists():
        env["PATH"] = f"{nvm_node20}:{env.get('PATH','')}"

    # Merge .env.dev as defaults, but let explicit env vars win.
    file_env = _load_env_file(REPO_ROOT / ".env.dev")
    for k, v in file_env.items():
        env.setdefault(k, v)

    # Force Cybertron infra targets
    env["DATABASE_URL"] = f"postgresql://postgres:postgres@localhost:{CYBERTRON_POSTGRES_PORT}/civil"
    env["REDIS_URL"] = f"redis://localhost:{CYBERTRON_REDIS_PORT}"
    env.setdefault("JWT_SECRET", "dev_secret")
    env.setdefault("NEXT_PUBLIC_API_BASE", "/api")
    env.setdefault("NEXT_PUBLIC_BASE_URL", "https://dev.civilcitizens.ca")
    env.setdefault("NEXT_PUBLIC_MEDIA_BASE_URL", "https://dev.civilcitizens.ca/media")
    env.setdefault("MEDIA_PUBLIC_BASE_URL", "https://dev.civilcitizens.ca/media")
    env.setdefault("MEDIA_S3_ENDPOINT", f"http://127.0.0.1:{CYBERTRON_MINIO_PORT}")

    # Ensure CybertronDev infra is up (postgres/redis/nginx/minio)
    try:
        _ensure_cybertron_up()
        _ensure_civil_db_role_and_db()
    except Exception as e:
        print(f"⚠ Could not ensure CybertronDev is up: {e}")

    # Ensure Prisma migrations are applied before starting the API.
    try:
        print("🗄️ Applying Prisma migrations (deploy)…")
        _apply_prisma_migrations(pnpm, env)
    except Exception as e:
        print("❌ Prisma migrate deploy failed.")
        print(f"   Error: {e}")
        print("   Fix migrations/DB connectivity, then re-run ./_DEV.py start")
        return 1

    # Port conflict handling
    for port in (WEB_PORT, API_PORT):
        if not _port_open("127.0.0.1", port):
            continue
        pids = _pids_listening_on_port(port)
        if any(_is_repo_dev_process(pid) for pid in pids):
            stop()
            break
        print(f"❌ Port {port} is already in use by a non-CivilCitizens process.")
        print("   Refusing to kill it. Free the port and retry.")
        return 1

    print(f"▶ Starting web (detached, Next Turbo) on :{WEB_PORT} (log: {WEB_LOG})")
    env["CIVIL_WEB_PORT"] = str(WEB_PORT)
    _spawn_detached(
        [pnpm, "--filter", "@civil/web", "exec", "next", "dev", "--turbo", "-H", "0.0.0.0", "-p", str(WEB_PORT)],
        cwd=CIVIL_DIR,
        pid_file=WEB_PID_FILE,
        log_file=WEB_LOG,
        env=env,
    )

    api_env = dict(env)
    api_env["PORT"] = str(API_PORT)

    print(f"▶ Starting api (detached) on :{API_PORT} (log: {API_LOG})")
    _spawn_detached(
        [pnpm, "--filter", "@civil/api", "dev"],
        cwd=CIVIL_DIR,
        pid_file=API_PID_FILE,
        log_file=API_LOG,
        env=api_env,
    )

    print(f"▶ Starting worker (detached) (log: {WORKER_LOG})")
    _spawn_detached(
        [pnpm, "--filter", "@civil/worker", "dev"],
        cwd=CIVIL_DIR,
        pid_file=WORKER_PID_FILE,
        log_file=WORKER_LOG,
        env=env,
    )

    deadline = time.time() + 20.0
    while time.time() < deadline:
        web_ok = _port_open("127.0.0.1", WEB_PORT)
        api_ok = _port_open("127.0.0.1", API_PORT)
        if web_ok and api_ok:
            print("✅ Dev processes are up")
            print(f"   - Web: http://localhost:{WEB_PORT}/")
            print(f"   - API: http://localhost:{API_PORT}/health")
            return 0
        time.sleep(0.25)

    print("⚠ Started processes, but ports did not become ready in time.")
    print(f"   - Web log: {WEB_LOG}")
    print(f"   - API log: {API_LOG}")
    print()
    print("== API last 60 lines ==")
    print(_tail(API_LOG, 60))
    return 1


def status() -> int:
    def line(label: str, pid_file: Path, port: int) -> str:
        pid = _read_pid(pid_file)
        alive = bool(pid and _pid_is_alive(pid))
        listeners = sorted(_pids_listening_on_port(port))
        listening = bool(listeners)

        pid_str = str(pid) if pid else "-"
        extra = ""
        if listeners:
            repo_listeners = [p for p in listeners if _is_repo_dev_process(p)]
            show_pid = repo_listeners[0] if repo_listeners else listeners[0]
            cmd = _cmdline(show_pid)
            extra = f" listenerPid={show_pid} cmd={cmd[:120]}" if cmd else f" listenerPid={show_pid}"
        return f"- {label}: pidFile={pid_str} alive={alive} port={port} listening={listening}{extra}"

    print(line("web", WEB_PID_FILE, WEB_PORT))
    print(line("api", API_PID_FILE, API_PORT))
    worker_pid = _read_pid(WORKER_PID_FILE)
    worker_alive = bool(worker_pid and _pid_is_alive(worker_pid))
    worker_cmd = _cmdline(worker_pid) if worker_pid else ""
    worker_extra = f" cmd={worker_cmd[:120]}" if worker_cmd else ""
    print(f"- worker: pidFile={worker_pid if worker_pid else '-'} alive={worker_alive}{worker_extra}")
    return 0


def logs(lines: int) -> int:
    print(f"== Web ({WEB_LOG}) last {lines} ==")
    print(_tail(WEB_LOG, lines))
    print()
    print(f"== API ({API_LOG}) last {lines} ==")
    print(_tail(API_LOG, lines))
    print()
    print(f"== Worker ({WORKER_LOG}) last {lines} ==")
    print(_tail(WORKER_LOG, lines))
    return 0


def _usage() -> str:
    return (
        "Usage:\n"
        "  _DEV.py               # restart (stop + start)\n"
        "  _DEV.py start         # start detached\n"
        "  _DEV.py stop          # stop detached\n"
        "  _DEV.py status        # show status\n"
        "  _DEV.py logs [N]      # tail logs (default 100)\n"
    )


def main(argv: list[str]) -> int:
    cmd = (argv[1] if len(argv) > 1 else "restart").strip().lower()
    if cmd in ("-h", "--help", "help"):
        print(_usage())
        return 0

    if cmd == "stop":
        return stop()
    if cmd == "start":
        return start()
    if cmd == "restart":
        stop()
        return start()
    if cmd == "status":
        return status()
    if cmd == "logs":
        n = 100
        if len(argv) > 2:
            try:
                n = int(argv[2])
            except ValueError:
                print("❌ logs expects an integer line count")
                return 2
        return logs(n)

    print(f"❌ Unknown command: {cmd}\n")
    print(_usage())
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
