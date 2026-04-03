#!/usr/bin/env python3
"""Civil Citizens DEV process manager.

Goal: fast iteration without Docker rebuild loops.

This manages on-host dev processes behind the local edge nginx proxy.

Edge proxy reference config:
- ops/dev.civilcitizens.ca.nginx.conf
- ops/dev-edge-proxy.compose.yml

Important storage rule:
- CybertronDev Postgres/Redis/MinIO are the shared local dev services.
- They back the normal app/dev experience and should be treated as persistent.
- Destructive test suites must use a dedicated test database, never the
    CybertronDev `civil` database.

This manages on-host dev processes behind the local edge nginx proxy:
- dev.civilcitizens.ca -> edge-nginx docker -> host:3900 -> CybertronDev nginx
- /      -> Next dev server (host :33101 by default)
- /api/  -> API dev server (host :3012 by default)
- /media -> MinIO in CybertronDev

Commands:
  _DEV.py               # restart (stop + start)
  _DEV.py start         # start detached
  _DEV.py stop          # stop detached
  _DEV.py status        # show status
    _DEV.py doctor        # show resolved ports/env + connectivity
    _DEV.py staging       # run pre-deploy staging checks (env, connectivity, builds)
    _DEV.py preflight     # alias for staging
  _DEV.py logs [N]      # tail logs (default 100)

Managed processes:
- web    (@civil/web dev)
- api    (@civil/api dev)
- worker (docker container)
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
from urllib.parse import urlsplit, urlunsplit


REPO_ROOT = Path(__file__).resolve().parent
CIVIL_DIR = REPO_ROOT / "civil"
CYBERTRON_COMPOSE = Path("/home/andre/CybertronDev/docker-compose.yml")
EDGE_PROXY_COMPOSE = REPO_ROOT / "ops" / "dev-edge-proxy.compose.yml"
EDGE_PROXY_CONFIG = REPO_ROOT / "ops" / "dev.civilcitizens.ca.nginx.conf"
EDGE_PROXY_PROJECT = "civil_dev_edge"
EDGE_PROXY_CONTAINER = "civil-dev-edge-nginx"
CIVIL_COMPOSE_FILE = CIVIL_DIR / "docker-compose.yml"
DEV_WORKER_PROJECT = "civil_dev_worker"

WEB_PORT = int(os.environ.get("CIVIL_WEB_PORT", "33101"))
# NOTE: In WSL2 + Docker Desktop, some ports can get mapped unexpectedly when
# accessed from containers via host.docker.internal. Defaulting away from 3002
# avoids a collision observed in practice.
API_PORT = int(os.environ.get("CIVIL_API_PORT", "3012"))
MEETING_RTC_PORT = int(os.environ.get("CIVIL_MEETING_RTC_PORT", "8788"))
EDGE_PROXY_PORT = int(os.environ.get("CIVIL_EDGE_PROXY_PORT", "80"))

CYBERTRON_POSTGRES_PORT = int(os.environ.get("CYBERTRON_POSTGRES_PORT", "5542"))
CYBERTRON_REDIS_PORT = int(os.environ.get("CYBERTRON_REDIS_PORT", "6579"))
CYBERTRON_MINIO_PORT = int(os.environ.get("CYBERTRON_MINIO_PORT", "9102"))
AI_SERVERS_FILE = CIVIL_DIR / "ai_servers.json"
AI_INSTRUCTIONS_FILE = CIVIL_DIR / "CIVIL_AI.md"

WEB_PID_FILE = Path("/tmp/civil-dev-web.pid")
API_PID_FILE = Path("/tmp/civil-dev-api.pid")
WORKER_PID_FILE = Path("/tmp/civil-dev-worker.pid")
MEETING_RTC_PID_FILE = Path("/tmp/civil-dev-meeting-rtc.pid")

WEB_LOG = Path("/tmp/civil-web.log")
API_LOG = Path("/tmp/civil-api.log")
WORKER_LOG = Path("/tmp/civil-worker.log")
MEETING_RTC_LOG = Path("/tmp/civil-meeting-rtc.log")

MEETING_RTC_DIR = REPO_ROOT / "builds" / "meetings" / "rtc-service"


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


def _cwd(pid: int) -> str:
    try:
        return os.readlink(f"/proc/{pid}/cwd")
    except OSError:
        return ""


def _is_repo_dev_process(pid: int) -> bool:
    cmd = _cmdline(pid)
    cwd = _cwd(pid)
    if not cmd:
        return cwd.startswith(str(REPO_ROOT)) if cwd else False

    if str(REPO_ROOT) in cmd:
        return True
    if cwd.startswith(str(REPO_ROOT)):
        return True

    # Heuristics for pnpm/next/tsx started from this repo
    if "next" in cmd and "dev" in cmd and "@civil/web" in cmd:
        return True
    if "tsx" in cmd and "watch" in cmd and "apps/api" in cmd:
        return True
    if "tsx" in cmd and "watch" in cmd and "apps/worker" in cmd:
        return True
    if "server.mjs" in cmd and "rtc-service" in cmd:
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


def _build_dev_env() -> dict[str, str]:
    env = os.environ.copy()

    nvm_node20 = Path.home() / ".nvm/versions/node/v20.19.6/bin"
    if nvm_node20.exists():
        env["PATH"] = f"{nvm_node20}:{env.get('PATH','')}"

    file_env = _load_env_file(REPO_ROOT / ".env.dev")
    for k, v in file_env.items():
        env.setdefault(k, v)

    default_database_url = f"postgresql://postgres:postgres@localhost:{CYBERTRON_POSTGRES_PORT}/civil"
    env["DATABASE_URL"] = os.environ.get("DATABASE_URL", file_env.get("DATABASE_URL", default_database_url))
    env["REDIS_URL"] = os.environ.get("REDIS_URL", file_env.get("REDIS_URL", f"redis://localhost:{CYBERTRON_REDIS_PORT}"))
    env.setdefault("JWT_SECRET", "dev_secret")
    env.setdefault("CIVIL_PUBLIC_HOST", "dev.civilcitizens.ca")
    env.setdefault("NEXT_PUBLIC_API_BASE", "/api")
    env.setdefault("NEXT_PUBLIC_BASE_URL", f"https://{env['CIVIL_PUBLIC_HOST']}")
    env.setdefault("NEXT_PUBLIC_MEDIA_BASE_URL", f"https://{env['CIVIL_PUBLIC_HOST']}/media")
    env.setdefault("MEDIA_PUBLIC_BASE_URL", f"https://{env['CIVIL_PUBLIC_HOST']}/media")
    env.setdefault("MEDIA_S3_ENDPOINT", f"http://127.0.0.1:{CYBERTRON_MINIO_PORT}")
    env.setdefault("CIVIL_NEXT_DIST_DIR", "/tmp/civil-next-dev")
    env.setdefault("MEETING_RTC_SERVICE_URL", f"http://127.0.0.1:{MEETING_RTC_PORT}")
    env.setdefault("MEETING_RTC_SERVICE_SECRET", "dev_meeting_rtc_secret")
    env.setdefault("MEETING_RTC_REQUEST_TIMEOUT_MS", "8000")
    env.setdefault("MEETING_RTC_WS_URL", f"wss://{env['CIVIL_PUBLIC_HOST']}/rtc/v1/ws")
    env.setdefault("MEETING_RTC_SESSION_TTL_SECONDS", "1800")
    env.setdefault("MEETING_RTC_ICE_SERVERS_JSON", '[{"urls":["stun:stun.l.google.com:19302"]}]')
    env.setdefault("CIVIL_AI_SERVERS_FILE", str(AI_SERVERS_FILE))
    env.setdefault("CIVIL_AI_INSTRUCTIONS_FILE", str(AI_INSTRUCTIONS_FILE))
    env.setdefault("CIVIL_WEB_PORT", str(WEB_PORT))
    env.setdefault("CIVIL_API_PORT", str(API_PORT))
    env.setdefault("PORT", str(API_PORT))
    return env


def _write_host_prisma_env(database_url: str) -> None:
    db_env_path = CIVIL_DIR / "packages" / "db" / ".env"
    try:
        db_env_path.parent.mkdir(parents=True, exist_ok=True)
        db_env_path.write_text(f"DATABASE_URL={database_url}\n", encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"unable to write Prisma env file at {db_env_path}: {exc}") from exc


def _run_check(label: str, cmd: list[str], *, cwd: Path, env: dict[str, str]) -> None:
    printable = " ".join(cmd)
    print(f"→ {label}: {printable}")
    subprocess.run(cmd, cwd=str(cwd), env=env, check=True)


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


def _ensure_edge_proxy_up() -> None:
    docker = shutil.which("docker")
    if not docker:
        raise RuntimeError("docker not found on PATH")
    if not EDGE_PROXY_COMPOSE.exists():
        raise RuntimeError(f"Missing edge proxy compose at {EDGE_PROXY_COMPOSE}")
    if not EDGE_PROXY_CONFIG.exists():
        raise RuntimeError(f"Missing edge proxy config at {EDGE_PROXY_CONFIG}")

    compose_up_cmd = [
        docker,
        "compose",
        "-p",
        EDGE_PROXY_PROJECT,
        "-f",
        str(EDGE_PROXY_COMPOSE),
        "up",
        "-d",
    ]

    result = subprocess.run(
        compose_up_cmd,
        check=False,
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        return

    combined_output = _strip_ansi_and_controls(f"{result.stdout}\n{result.stderr}")
    conflict_message = f'the container name "/{EDGE_PROXY_CONTAINER}" is already in use'
    if conflict_message in combined_output.lower():
        subprocess.run(
            [docker, "rm", "-f", EDGE_PROXY_CONTAINER],
            check=False,
            cwd=str(REPO_ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        retry = subprocess.run(
            compose_up_cmd,
            check=False,
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        if retry.returncode == 0:
            return
        raise subprocess.CalledProcessError(
            retry.returncode,
            compose_up_cmd,
            output=retry.stdout,
            stderr=retry.stderr,
        )

    raise subprocess.CalledProcessError(
        result.returncode,
        compose_up_cmd,
        output=result.stdout,
        stderr=result.stderr,
    )


def _dev_worker_env(env: dict[str, str]) -> dict[str, str]:
    def _translate_host_url(raw: str, *, default_port: int | None = None) -> str:
        value = (raw or '').strip()
        if not value:
            return value
        try:
            parts = urlsplit(value)
        except Exception:
            return value
        hostname = parts.hostname or ''
        if hostname not in {'localhost', '127.0.0.1', '0.0.0.0'}:
            return value
        username = parts.username or ''
        password = parts.password or ''
        auth = ''
        if username:
            auth = username
            if password:
                auth += f':{password}'
            auth += '@'
        port = parts.port if parts.port is not None else default_port
        netloc = f"{auth}host.docker.internal"
        if port is not None:
            netloc += f':{port}'
        return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))

    worker_env = dict(env)
    worker_env["DATABASE_URL"] = _translate_host_url(worker_env.get("DATABASE_URL", ""), default_port=CYBERTRON_POSTGRES_PORT)
    worker_env["REDIS_URL"] = _translate_host_url(worker_env.get("REDIS_URL", ""), default_port=CYBERTRON_REDIS_PORT)
    worker_env["MEDIA_S3_ENDPOINT"] = _translate_host_url(worker_env.get("MEDIA_S3_ENDPOINT", ""), default_port=CYBERTRON_MINIO_PORT)
    worker_env["MEETING_RTC_SERVICE_URL"] = _translate_host_url(worker_env.get("MEETING_RTC_SERVICE_URL", ""), default_port=MEETING_RTC_PORT)
    worker_env["CIVIL_AI_SERVERS_FILE"] = "/app/ai_servers.json"
    worker_env["CIVIL_AI_INSTRUCTIONS_FILE"] = "/app/CIVIL_AI.md"
    return worker_env


def _run_dev_worker_compose(args: list[str], env: dict[str, str], *, capture_output: bool = False) -> subprocess.CompletedProcess[str] | None:
    docker = shutil.which("docker")
    if not docker:
        raise RuntimeError("docker not found on PATH")
    if not CIVIL_COMPOSE_FILE.exists():
        raise RuntimeError(f"Missing Civil compose file at {CIVIL_COMPOSE_FILE}")

    cmd = [
        docker,
        "compose",
        "-p",
        DEV_WORKER_PROJECT,
        "-f",
        str(CIVIL_COMPOSE_FILE),
        "--profile",
        "infra",
        "--profile",
        "app",
        *args,
    ]
    if capture_output:
        return subprocess.run(cmd, check=False, cwd=str(CIVIL_DIR), env=env, capture_output=True, text=True)
    subprocess.run(cmd, check=True, cwd=str(CIVIL_DIR), env=env)
    return None


def _ensure_dev_worker_up(env: dict[str, str]) -> None:
    worker_env = _dev_worker_env(env)
    _run_dev_worker_compose(["up", "-d", "--build", "--no-deps", "worker"], worker_env)


def _stop_dev_worker(env: dict[str, str] | None = None) -> bool:
    worker_env = _dev_worker_env(env or _build_dev_env())
    try:
        result = _run_dev_worker_compose(["ps", "--services", "--status", "running", "worker"], worker_env, capture_output=True)
        was_running = bool(result and "worker" in result.stdout.splitlines())
    except Exception:
        was_running = False

    try:
        _run_dev_worker_compose(["rm", "-f", "-s", "worker"], worker_env)
    except Exception:
        pass
    return was_running


def _dev_worker_running(env: dict[str, str] | None = None) -> bool:
    worker_env = _dev_worker_env(env or _build_dev_env())
    try:
        result = _run_dev_worker_compose(["ps", "--services", "--status", "running", "worker"], worker_env, capture_output=True)
    except Exception:
        return False
    return bool(result and "worker" in result.stdout.splitlines())


def _tail_dev_worker_logs(env: dict[str, str], lines: int) -> str:
    result = _run_dev_worker_compose(["logs", "--tail", str(lines), "worker"], _dev_worker_env(env), capture_output=True)
    if not result:
        return "(worker logs unavailable)"
    combined = (result.stdout or "") + ("\n" + result.stderr if result.stderr else "")
    output = _strip_ansi_and_controls(combined).strip()
    return output or "(worker logs unavailable)"


def _stop_edge_proxy() -> None:
    docker = shutil.which("docker")
    if not docker or not EDGE_PROXY_COMPOSE.exists():
        return

    subprocess.run(
        [
            docker,
            "compose",
            "-p",
            EDGE_PROXY_PROJECT,
            "-f",
            str(EDGE_PROXY_COMPOSE),
            "down",
        ],
        check=False,
        cwd=str(REPO_ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _edge_proxy_running() -> bool:
    docker = shutil.which("docker")
    if not docker or not EDGE_PROXY_COMPOSE.exists():
        return False

    result = subprocess.run(
        [
            docker,
            "compose",
            "-p",
            EDGE_PROXY_PROJECT,
            "-f",
            str(EDGE_PROXY_COMPOSE),
            "ps",
            "--services",
            "--status",
            "running",
        ],
        check=False,
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    return "edge-nginx" in result.stdout.splitlines()


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


def _ensure_meeting_rtc_deps(env: dict[str, str]) -> None:
    if not MEETING_RTC_DIR.exists():
        raise RuntimeError(f"missing meeting rtc service directory: {MEETING_RTC_DIR}")

    ws_pkg = MEETING_RTC_DIR / "node_modules" / "ws" / "package.json"
    if ws_pkg.exists():
        return

    npm = shutil.which("npm", path=env.get("PATH"))
    if not npm:
        raise RuntimeError("npm not found on PATH for meeting rtc dependencies")

    subprocess.run(
        [npm, "ci", "--no-audit", "--no-fund"],
        cwd=str(MEETING_RTC_DIR),
        env=env,
        check=True,
    )


def stop() -> int:
    stopped_any = False
    env = _build_dev_env()

    edge_proxy_was_running = _edge_proxy_running() or _port_open("127.0.0.1", EDGE_PROXY_PORT)
    _stop_edge_proxy()
    if edge_proxy_was_running:
        print(f"⏹ Stopping edge-proxy docker on :{EDGE_PROXY_PORT}")
        stopped_any = True

    for label, pid_file in (
        ("web", WEB_PID_FILE),
        ("api", API_PID_FILE),
        ("worker", WORKER_PID_FILE),
        ("meeting-rtc", MEETING_RTC_PID_FILE),
    ):
        pid = _read_pid(pid_file)
        if pid and _pid_is_alive(pid):
            print(f"⏹ Stopping {label} (pid {pid})")
            _kill_process_group(pid)
            stopped_any = True
        try:
            pid_file.unlink(missing_ok=True)
        except Exception:
            pass

    for port, label in ((WEB_PORT, "web"), (API_PORT, "api"), (MEETING_RTC_PORT, "meeting-rtc")):
        for pid in sorted(_pids_listening_on_port(port)):
            if not _pid_is_alive(pid):
                continue
            if not _is_repo_dev_process(pid):
                continue
            print(f"⏹ Stopping {label} listener on port {port} (pid {pid})")
            _kill_process_group(pid)
            stopped_any = True

    if _stop_dev_worker(env):
        print("⏹ Stopping worker container")
        stopped_any = True

    if not stopped_any:
        print("✅ Nothing to stop")
    return 0


def start() -> int:
    pnpm = shutil.which("pnpm")
    if not pnpm:
        print("❌ pnpm not found on PATH.")
        return 2

    env = _build_dev_env()

    try:
        _write_host_prisma_env(env["DATABASE_URL"])
        print(f"📝 Synced host Prisma env: {CIVIL_DIR / 'packages' / 'db' / '.env'}")
    except Exception as e:
        print("❌ Unable to write host Prisma env.")
        print(f"   Error: {e}")
        return 1

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

    # Ensure meeting RTC dependencies are installed before launching the service.
    try:
        _ensure_meeting_rtc_deps(env)
    except Exception as e:
        print("❌ Meeting RTC dependency install failed.")
        print(f"   Error: {e}")
        print("   Fix meeting RTC dependencies, then re-run python3 _DEV.py start")
        return 1

    # Port conflict handling
    for port in (WEB_PORT, API_PORT, MEETING_RTC_PORT):
        if not _port_open("127.0.0.1", port):
            continue
        pids = _pids_listening_on_port(port)
        if any(_is_repo_dev_process(pid) for pid in pids):
            stop()
            break
        print(f"❌ Port {port} is already in use by a non-CivilCitizens process.")
        print("   Refusing to kill it. Free the port and retry.")
        return 1

    try:
        _ensure_edge_proxy_up()
    except Exception as e:
        print("❌ Edge proxy startup failed.")
        print(f"   Error: {e}")
        print("   Fix Docker/port 80 conflicts, then re-run python3 _DEV.py start")
        return 1

    print(f"▶ Starting web (detached, Next Webpack) on :{WEB_PORT} (log: {WEB_LOG})")
    env["CIVIL_WEB_PORT"] = str(WEB_PORT)
    env["CIVIL_API_PORT"] = str(API_PORT)
    _spawn_detached(
        [pnpm, "--filter", "@civil/web", "exec", "next", "dev", "-H", "0.0.0.0", "-p", str(WEB_PORT)],
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

    print("▶ Starting worker container (docker compose build + up)")
    try:
        _ensure_dev_worker_up(env)
    except Exception as e:
        print("❌ Worker container startup failed.")
        print(f"   Error: {e}")
        print("   Fix Docker/build issues, then re-run ./_DEV.py start")
        return 1

    meeting_rtc_env = dict(env)
    meeting_rtc_env["PORT"] = str(MEETING_RTC_PORT)
    meeting_rtc_env["MEETING_RTC_SECRET"] = env.get("MEETING_RTC_SERVICE_SECRET", "")
    meeting_rtc_env["RTC_WS_URL"] = env.get("MEETING_RTC_WS_URL", "")
    meeting_rtc_env["RTC_ICE_SERVERS_JSON"] = env.get("MEETING_RTC_ICE_SERVERS_JSON", "")
    meeting_rtc_env["RTC_SESSION_TTL_SECONDS"] = env.get("MEETING_RTC_SESSION_TTL_SECONDS", "1800")
    if "MEETING_RTC_HEARTBEAT_INTERVAL_MS" in env:
        meeting_rtc_env["RTC_HEARTBEAT_INTERVAL_MS"] = env["MEETING_RTC_HEARTBEAT_INTERVAL_MS"]

    print(f"▶ Starting meeting-rtc (detached) on :{MEETING_RTC_PORT} (log: {MEETING_RTC_LOG})")
    _spawn_detached(
        ["node", "server.mjs"],
        cwd=MEETING_RTC_DIR,
        pid_file=MEETING_RTC_PID_FILE,
        log_file=MEETING_RTC_LOG,
        env=meeting_rtc_env,
    )

    deadline = time.time() + 20.0
    while time.time() < deadline:
        web_ok = _port_open("127.0.0.1", WEB_PORT)
        api_ok = _port_open("127.0.0.1", API_PORT)
        rtc_ok = _port_open("127.0.0.1", MEETING_RTC_PORT)
        edge_ok = _port_open("127.0.0.1", EDGE_PROXY_PORT)
        worker_ok = _dev_worker_running(env)
        if web_ok and api_ok and rtc_ok and edge_ok and worker_ok:
            print("✅ Dev processes are up")
            print(f"   - Edge proxy: http://localhost:{EDGE_PROXY_PORT}/nginx-health")
            print(f"   - Web: http://localhost:{WEB_PORT}/")
            print(f"   - API: http://localhost:{API_PORT}/health")
            print(f"   - Meeting RTC: http://localhost:{MEETING_RTC_PORT}/health")
            print("   - Worker: docker compose service running")
            return 0
        time.sleep(0.25)

    print("⚠ Started processes, but ports did not become ready in time.")
    print(f"   - Web log: {WEB_LOG}")
    print(f"   - API log: {API_LOG}")
    print(f"   - Meeting RTC log: {MEETING_RTC_LOG}")
    print()
    print("== API last 60 lines ==")
    print(_tail(API_LOG, 60))
    print()
    print("== Worker last 60 lines ==")
    print(_tail_dev_worker_logs(env, 60))
    return 1


def status() -> int:
    print(f"- edge-proxy: composeRunning={_edge_proxy_running()} port={EDGE_PROXY_PORT} listening={_port_open('127.0.0.1', EDGE_PROXY_PORT)}")

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
    print(line("meeting-rtc", MEETING_RTC_PID_FILE, MEETING_RTC_PORT))
    print(f"- worker: containerRunning={_dev_worker_running()}")
    return 0


def logs(lines: int) -> int:
    print(f"== Web ({WEB_LOG}) last {lines} ==")
    print(_tail(WEB_LOG, lines))
    print()
    print(f"== API ({API_LOG}) last {lines} ==")
    print(_tail(API_LOG, lines))
    print()
    print(f"== Worker (docker compose) last {lines} ==")
    print(_tail_dev_worker_logs(_build_dev_env(), lines))
    print()
    print(f"== Meeting RTC ({MEETING_RTC_LOG}) last {lines} ==")
    print(_tail(MEETING_RTC_LOG, lines))
    return 0


def doctor() -> int:
    file_env = _load_env_file(REPO_ROOT / ".env.dev")
    shadow_postgres_port = int(os.environ.get("POSTGRES_GIS_HOST_PORT", file_env.get("POSTGRES_GIS_HOST_PORT", "5743")))

    database_url = os.environ.get(
        "DATABASE_URL",
        file_env.get("DATABASE_URL", f"postgresql://postgres:postgres@localhost:{CYBERTRON_POSTGRES_PORT}/civil"),
    )
    shadow_database_url = file_env.get(
        "SHADOW_DATABASE_URL",
        f"postgresql://postgres:postgres@localhost:{shadow_postgres_port}/civil",
    )
    redis_url = os.environ.get("REDIS_URL", file_env.get("REDIS_URL", f"redis://localhost:{CYBERTRON_REDIS_PORT}"))
    api_base = os.environ.get("NEXT_PUBLIC_API_BASE", file_env.get("NEXT_PUBLIC_API_BASE", "/api"))
    public_host = os.environ.get("CIVIL_PUBLIC_HOST", file_env.get("CIVIL_PUBLIC_HOST", "dev.civilcitizens.ca"))
    base_url = os.environ.get("NEXT_PUBLIC_BASE_URL", file_env.get("NEXT_PUBLIC_BASE_URL", f"https://{public_host}"))
    media_base = os.environ.get(
        "NEXT_PUBLIC_MEDIA_BASE_URL",
        file_env.get("NEXT_PUBLIC_MEDIA_BASE_URL", f"https://{public_host}/media"),
    )
    meeting_rtc_service_url = os.environ.get(
        "MEETING_RTC_SERVICE_URL",
        file_env.get("MEETING_RTC_SERVICE_URL", f"http://127.0.0.1:{MEETING_RTC_PORT}"),
    )
    meeting_rtc_ws_url = os.environ.get(
        "MEETING_RTC_WS_URL",
        file_env.get("MEETING_RTC_WS_URL", f"wss://{public_host}/rtc/v1/ws"),
    )
    civil_ai_servers_file = os.environ.get("CIVIL_AI_SERVERS_FILE", file_env.get("CIVIL_AI_SERVERS_FILE", str(AI_SERVERS_FILE)))
    civil_ai_instructions_file = os.environ.get(
        "CIVIL_AI_INSTRUCTIONS_FILE",
        file_env.get("CIVIL_AI_INSTRUCTIONS_FILE", str(AI_INSTRUCTIONS_FILE)),
    )

    print("== Effective dev configuration ==")
    print("- NOTE: CybertronDev Postgres/Redis are shared local dev services, not disposable test targets")
    print(f"- CIVIL_WEB_PORT={WEB_PORT}")
    print(f"- CIVIL_API_PORT={API_PORT}")
    print(f"- CYBERTRON_POSTGRES_PORT={CYBERTRON_POSTGRES_PORT}")
    print(f"- POSTGRES_GIS_HOST_PORT={shadow_postgres_port}")
    print(f"- CYBERTRON_REDIS_PORT={CYBERTRON_REDIS_PORT}")
    print(f"- CYBERTRON_MINIO_PORT={CYBERTRON_MINIO_PORT}")
    print(f"- CIVIL_EDGE_PROXY_PORT={EDGE_PROXY_PORT}")
    print(f"- CIVIL_PUBLIC_HOST={public_host}")
    print(f"- NEXT_PUBLIC_API_BASE={api_base}")
    print(f"- NEXT_PUBLIC_BASE_URL={base_url}")
    print(f"- NEXT_PUBLIC_MEDIA_BASE_URL={media_base}")
    print(f"- CIVIL_AI_SERVERS_FILE={civil_ai_servers_file}")
    print(f"- CIVIL_AI_INSTRUCTIONS_FILE={civil_ai_instructions_file}")
    test_database_url = None
    try:
        parsed = re.match(r"^(postgresql://[^/]+/)([^?]+)(.*)$", database_url)
        if parsed:
            test_database_url = f"{parsed.group(1)}civil_test{parsed.group(3)}"
    except Exception:
        test_database_url = None

    print(f"- DATABASE_URL={database_url}")
    print(f"- RECOMMENDED_SHADOW_DATABASE_URL={shadow_database_url}")
    if test_database_url:
        print(f"- RECOMMENDED_TEST_DATABASE_URL={test_database_url}")
    print(f"- REDIS_URL={redis_url}")
    print(f"- MEETING_RTC_SERVICE_URL={meeting_rtc_service_url}")
    print(f"- MEETING_RTC_WS_URL={meeting_rtc_ws_url}")
    print(f"- CIVIL_MEETING_RTC_PORT={MEETING_RTC_PORT}")
    print(f"- ai_servers.json exists={Path(civil_ai_servers_file).exists()}")
    print(f"- CIVIL_AI.md exists={Path(civil_ai_instructions_file).exists()}")
    print()

    print("== Connectivity ==")
    print(f"- localhost:{WEB_PORT} open={_port_open('127.0.0.1', WEB_PORT)} (web)")
    print(f"- localhost:{API_PORT} open={_port_open('127.0.0.1', API_PORT)} (api)")
    print(f"- localhost:{CYBERTRON_POSTGRES_PORT} open={_port_open('127.0.0.1', CYBERTRON_POSTGRES_PORT)} (postgres)")
    print(f"- localhost:{shadow_postgres_port} open={_port_open('127.0.0.1', shadow_postgres_port)} (postgres-gis-shadow)")
    print(f"- localhost:{CYBERTRON_REDIS_PORT} open={_port_open('127.0.0.1', CYBERTRON_REDIS_PORT)} (redis)")
    print(f"- localhost:{CYBERTRON_MINIO_PORT} open={_port_open('127.0.0.1', CYBERTRON_MINIO_PORT)} (minio)")
    print(f"- localhost:{MEETING_RTC_PORT} open={_port_open('127.0.0.1', MEETING_RTC_PORT)} (meeting-rtc)")
    print(f"- localhost:{EDGE_PROXY_PORT} open={_port_open('127.0.0.1', EDGE_PROXY_PORT)} (edge-proxy)")

    db_env = _load_env_file(CIVIL_DIR / "packages" / "db" / ".env")
    db_url = db_env.get("DATABASE_URL")
    if db_url:
        m = re.search(r"@([^:/]+):(\d+)", db_url)
        if m:
            host, port_s = m.group(1), m.group(2)
            try:
                port = int(port_s)
            except ValueError:
                port = -1
            if port > 0:
                print(f"- packages/db/.env -> {host}:{port} open={_port_open(host, port)}")

    if test_database_url:
        m = re.search(r"@([^:/]+):(\d+)", test_database_url)
        if m:
            host, port_s = m.group(1), m.group(2)
            try:
                port = int(port_s)
            except ValueError:
                port = -1
            if port > 0:
                print(f"- recommended test db host/port -> {host}:{port} open={_port_open(host, port)}")

    return 0


def staging() -> int:
    pnpm = shutil.which("pnpm")
    if not pnpm:
        print("❌ pnpm not found on PATH.")
        return 2

    env = _build_dev_env()

    print("== Staging checks ==")
    print("This validates the DEV environment against the build steps most likely to fail during PROD deploys.")
    print()

    doctor_result = doctor()
    if doctor_result != 0:
        return doctor_result

    try:
        _write_host_prisma_env(env["DATABASE_URL"])
        print(f"- Wrote host Prisma env: {CIVIL_DIR / 'packages' / 'db' / '.env'}")

        _run_check("Build @civil/db", [pnpm, "--filter", "@civil/db", "build"], cwd=CIVIL_DIR, env=env)
        _run_check("Generate Prisma client", [pnpm, "--filter", "@civil/db", "generate"], cwd=CIVIL_DIR, env=env)
        _run_check("Build @civil/shared", [pnpm, "--filter", "@civil/shared", "build"], cwd=CIVIL_DIR, env=env)
        _run_check("Build @civil/ui", [pnpm, "--filter", "@civil/ui", "build"], cwd=CIVIL_DIR, env=env)
        _run_check("Build @civil/api", [pnpm, "--filter", "@civil/api", "build"], cwd=CIVIL_DIR, env=env)
        _run_check("Build @civil/worker", [pnpm, "--filter", "@civil/worker", "build"], cwd=CIVIL_DIR, env=env)
        _run_check("Build @civil/web", [pnpm, "--filter", "@civil/web", "build"], cwd=CIVIL_DIR, env=env)
        _run_check("Check web assets", [pnpm, "--filter", "@civil/web", "smoke:assets"], cwd=CIVIL_DIR, env=env)
    except subprocess.CalledProcessError as exc:
        print()
        print(f"❌ staging failed on command with exit code {exc.returncode}")
        return exc.returncode or 1
    except Exception as exc:
        print()
        print(f"❌ staging failed: {exc}")
        return 1

    print()
    print("✅ staging passed")
    print("This branch is in better shape for a PROD deploy because the app packages built successfully on DEV first.")
    return 0


def preflight() -> int:
    return staging()


def _usage() -> str:
    return (
        "Usage:\n"
        "  _DEV.py               # restart (stop + start)\n"
        "  _DEV.py start         # start detached\n"
        "  _DEV.py stop          # stop detached\n"
        "  _DEV.py status        # show status\n"
    "  _DEV.py doctor        # show resolved ports/env + connectivity\n"
    "  _DEV.py staging       # run pre-deploy staging checks (env, connectivity, builds)\n"
    "  _DEV.py preflight     # alias for staging\n"
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
    if cmd == "doctor":
        return doctor()
    if cmd == "preflight":
        return preflight()
    if cmd in ("staging", "preflight"):
        return staging()
    if cmd == "staging":
        return staging()
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
