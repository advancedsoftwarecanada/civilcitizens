from __future__ import annotations

import atexit
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

ROOT_DIR = Path(__file__).resolve().parents[1]
LOCAL_CONFIG_DIR = ROOT_DIR / "_production_server"
PUSH_IGNORE_FILE = LOCAL_CONFIG_DIR / "push_ignore.txt"
CIVIL_REMOTE_DATA_DIR = "/Users/andrewnormore/CIVIL_DATA"
CIVIL_REMOTE_APP_DIR = "/Users/andrewnormore/CIVIL"
CIVIL_REMOTE_MINIO_DIR = "/Volumes/CivilData/minio"
LOCAL_LARGEFILES_DIR = ROOT_DIR / "civilcitizens_largefiles" / "_geodata"


@dataclass(frozen=True)
class RemoteConfig:
    host: str
    user: str
    port: str
    identity_file: str | None
    remote_dir: str


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return None


def _local_config_dirs() -> list[Path]:
    dirs: list[Path] = []
    if LOCAL_CONFIG_DIR.is_dir():
        dirs.append(LOCAL_CONFIG_DIR)

        backups = [
            p for p in LOCAL_CONFIG_DIR.glob("_production_server_backup_*")
            if p.is_dir()
        ]
        backups.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        dirs.extend(backups)
    return dirs


def _read_local_config_value(name: str) -> str:
    for d in _local_config_dirs():
        v = (_read_text(d / name) or "").strip()
        if v:
            return v
    return ""


def _read_local_config_raw(name: str) -> str:
    for d in _local_config_dirs():
        p = d / name
        if not p.is_file():
            continue
        try:
            return p.read_text(encoding="utf-8")
        except OSError:
            continue
    return ""


def _find_local_config_file(name: str) -> str:
    for d in _local_config_dirs():
        p = d / name
        if p.is_file():
            return str(p)
    return str(LOCAL_CONFIG_DIR / name)


def _load_push_ignore_patterns() -> list[str]:
    raw = _read_text(PUSH_IGNORE_FILE)
    if not raw:
        return []
    out: list[str] = []
    for line in raw.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        out.append(s)
    return out


def resolve_remote_config() -> RemoteConfig:
    host = (os.environ.get("CIVIL_PROD_HOST") or _read_local_config_value("host.txt") or "").strip()
    user = (os.environ.get("CIVIL_PROD_USER") or _read_local_config_value("user.txt") or "").strip()

    if not host:
        raise RuntimeError("Missing production host. Set CIVIL_PROD_HOST or _production_server/host.txt")
    if not user:
        raise RuntimeError("Missing production user. Set CIVIL_PROD_USER or _production_server/user.txt")

    port = (os.environ.get("CIVIL_PROD_PORT") or "22").strip()
    remote_dir = (os.environ.get("CIVIL_PROD_REMOTE_DIR") or CIVIL_REMOTE_APP_DIR).strip()

    identity_file = (os.environ.get("CIVIL_PROD_IDENTITY_FILE") or "").strip()
    if not identity_file:
        ssh_raw = _read_local_config_raw("ssh.txt")
        ssh_value = ssh_raw.strip()
        if ssh_value.startswith("-----BEGIN"):
            tmp = tempfile.NamedTemporaryFile(prefix="civil-prod-key-", suffix=".pem", delete=False)
            payload = ssh_raw if ssh_raw.endswith("\n") else f"{ssh_raw}\n"
            tmp.write(payload.encode("utf-8"))
            tmp.flush()
            tmp.close()
            os.chmod(tmp.name, 0o600)
            atexit.register(lambda p=tmp.name: os.path.exists(p) and os.remove(p))
            identity_file = tmp.name
        elif ssh_value:
            ssh_path = Path(ssh_value)
            if not ssh_path.is_absolute():
                ssh_path = (LOCAL_CONFIG_DIR / ssh_path).resolve()
            identity_file = str(ssh_path)

    if not identity_file:
        identity_file = None

    return RemoteConfig(host=host, user=user, port=port, identity_file=identity_file, remote_dir=remote_dir)


def _ssh_base(cfg: RemoteConfig) -> list[str]:
    cmd = [
        "ssh",
        "-p",
        cfg.port,
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]
    if cfg.identity_file:
        cmd.extend(["-i", cfg.identity_file])
    cmd.append(f"{cfg.user}@{cfg.host}")
    return cmd


def _run(cmd: list[str], *, cwd: Path | None = None) -> None:
    subprocess.run(cmd, check=True, cwd=str(cwd) if cwd else None)


def remote_exec(cfg: RemoteConfig, script: str, *, extra_env: dict[str, str] | None = None) -> None:
    env_prefix = ""
    if extra_env:
        parts: list[str] = []
        for k, v in extra_env.items():
            parts.append(f"{k}={shlex.quote(str(v))}")
        env_prefix = " ".join(parts) + " "

    remote_cmd = f"{env_prefix}bash -lc {shlex.quote(script)}"
    cmd = _ssh_base(cfg) + ["--", remote_cmd]
    _run(cmd)


def _tar_excludes() -> list[str]:
    # Keep deploy payload small and avoid copying secrets.
    base = [
        ".git",
        ".env",
        ".env.*",
        # Never upload local secret material to production.
        "secrets",
        "node_modules",
        "**/node_modules",
        ".pnpm-store",
        "**/.pnpm-store",
        "**/.next",
        "**/dist",
        "**/build",
        "buildlogs",
        "__pycache__",
        "**/__pycache__",
        ".vscode",
        ".idea",
        "_production_server/ssh.txt",
        "_production_server/host.txt",
        "_production_server/user.txt",
        "*.sqlite",
        "*.sqlite3",
        "*.db",
    ]
    return [*base, *_load_push_ignore_patterns()]


def _rsync_excludes() -> list[str]:
    # Reuse the tar exclude list; rsync supports the same patterns.
    # Add a couple of extra safety nets.
    return [
        *_tar_excludes(),
        "*.pem",
        "*.key",
    ]


def upload_repo_rsync(cfg: RemoteConfig, *, excludes: Iterable[str] | None = None) -> None:
    rsync = shutil.which("rsync")
    if not rsync:
        raise RuntimeError("rsync not found on PATH")

    exclude_list = list(excludes or _rsync_excludes())

    # Ensure destination exists.
    remote_exec(cfg, f"mkdir -p {shlex.quote(cfg.remote_dir)}")

    ssh_parts = [
        "ssh",
        "-p",
        shlex.quote(cfg.port),
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]
    if cfg.identity_file:
        ssh_parts += ["-i", shlex.quote(cfg.identity_file)]

    cmd: list[str] = [
        rsync,
        "-az",
        "--delete",
        "--chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r",
        "--no-times",
    ]
    for ex in exclude_list:
        cmd += ["--exclude", ex]

    cmd += [
        "-e",
        " ".join(ssh_parts),
        "./",
        f"{cfg.user}@{cfg.host}:{cfg.remote_dir.rstrip('/')}/",
    ]

    _run(cmd, cwd=ROOT_DIR)


def upload_repo(cfg: RemoteConfig, *, excludes: Iterable[str] | None = None) -> None:
    # Prefer rsync if available; fall back to tar-over-SSH.
    if shutil.which("rsync"):
        upload_repo_rsync(cfg, excludes=excludes)
        return

    exclude_list = list(excludes or _tar_excludes())

    tar_cmd: list[str] = ["tar", "-czf", "-"]
    for ex in exclude_list:
        tar_cmd += ["--exclude", ex]
    # Extra safety: never ship private keys/certs.
    tar_cmd += ["--exclude", "*.pem", "--exclude", "*.key"]
    tar_cmd.append(".")

    remote_extract = (
        f"set -euo pipefail; mkdir -p {shlex.quote(cfg.remote_dir)}; "
        f"tar -xzf - -C {shlex.quote(cfg.remote_dir)}"
    )

    ssh_cmd = _ssh_base(cfg) + ["--", "bash", "-lc", remote_extract]

    tar_proc = subprocess.Popen(tar_cmd, cwd=str(ROOT_DIR), stdout=subprocess.PIPE)
    assert tar_proc.stdout is not None
    ssh_proc = subprocess.Popen(ssh_cmd, stdin=tar_proc.stdout)
    tar_proc.stdout.close()

    ssh_rc = ssh_proc.wait()
    tar_rc = tar_proc.wait()
    if tar_rc != 0:
        raise RuntimeError(f"tar failed with exit code {tar_rc}")
    if ssh_rc != 0:
        raise RuntimeError(f"ssh extract failed with exit code {ssh_rc}")


def upload_files_rsync(cfg: RemoteConfig, local_files: list[Path], remote_dir: str) -> None:
    rsync = shutil.which("rsync")
    if not rsync:
        raise RuntimeError("rsync not found on PATH")
    if not local_files:
        raise RuntimeError("No local files provided for upload")

    missing = [str(path) for path in local_files if not path.is_file()]
    if missing:
        raise RuntimeError("Missing local files for upload: " + ", ".join(missing))

    remote_exec(cfg, f"mkdir -p {shlex.quote(remote_dir)}")

    ssh_parts = [
        "ssh",
        "-p",
        shlex.quote(cfg.port),
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]
    if cfg.identity_file:
        ssh_parts += ["-i", shlex.quote(cfg.identity_file)]

    cmd: list[str] = [
        rsync,
        "-az",
        "--no-times",
        "-e",
        " ".join(ssh_parts),
    ]
    cmd.extend([str(path) for path in local_files])
    cmd.append(f"{cfg.user}@{cfg.host}:{remote_dir.rstrip('/')}/")
    _run(cmd, cwd=ROOT_DIR)


def remote_check(cfg: RemoteConfig) -> None:
    app_dir = os.environ.get("CIVIL_PROD_REMOTE_DIR", CIVIL_REMOTE_APP_DIR)
    data_dir = os.environ.get("CIVIL_PROD_DATA_DIR", CIVIL_REMOTE_DATA_DIR)
    minio_dir = os.environ.get("CIVIL_PROD_MINIO_DIR", CIVIL_REMOTE_MINIO_DIR)

    script = """
set -euo pipefail
whoami
hostname

echo "\n[paths]"
ls -ld APP_DIR DATA_DIR DATA_DIR/postgresql DATA_DIR/redis MINIO_DIR 2>/dev/null || true

echo "\n[mounts]"
mount | grep -E 'CivilData|/Volumes' || true
df -h /Volumes/CivilData 2>/dev/null || true

command -v docker >/dev/null && docker --version
command -v docker >/dev/null && docker compose version
command -v python3 >/dev/null && python3 --version

echo "\n[docker services snapshot]"
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'postgres|redis|minio|civil' || true
""".strip()
    script = script.replace("APP_DIR", shlex.quote(app_dir))
    script = script.replace("DATA_DIR", shlex.quote(data_dir))
    script = script.replace("MINIO_DIR", shlex.quote(minio_dir))
    remote_exec(cfg, script)


def remote_prepare(cfg: RemoteConfig) -> None:
    app_dir = os.environ.get("CIVIL_PROD_REMOTE_DIR", CIVIL_REMOTE_APP_DIR)
    data_dir = os.environ.get("CIVIL_PROD_DATA_DIR", CIVIL_REMOTE_DATA_DIR)
    minio_dir = os.environ.get("CIVIL_PROD_MINIO_DIR", CIVIL_REMOTE_MINIO_DIR)

    script = """
set -euo pipefail

mkdir -p APP_DIR
mkdir -p DATA_DIR/postgresql DATA_DIR/redis

if [ -d /Volumes/CivilData ]; then
    mkdir -p MINIO_DIR
    echo "OK: CivilData mounted; MinIO dir ensured at MINIO_DIR"
else
    echo "WARN: /Volumes/CivilData is not mounted. MinIO persistence path may be unavailable."
fi

echo "Prepared paths:"
ls -ld APP_DIR DATA_DIR DATA_DIR/postgresql DATA_DIR/redis MINIO_DIR 2>/dev/null || true

if command -v docker >/dev/null 2>&1; then
    docker network inspect public_proxy >/dev/null 2>&1 || docker network create public_proxy >/dev/null
    echo "Ensured docker network: public_proxy"
fi
""".strip()
    script = script.replace("APP_DIR", shlex.quote(app_dir))
    script = script.replace("DATA_DIR", shlex.quote(data_dir))
    script = script.replace("MINIO_DIR", shlex.quote(minio_dir))
    remote_exec(cfg, script)


def remote_deploy(cfg: RemoteConfig) -> None:
    data_dir = os.environ.get("CIVIL_PROD_DATA_DIR", CIVIL_REMOTE_DATA_DIR)
    minio_dir = os.environ.get("CIVIL_PROD_MINIO_DIR", CIVIL_REMOTE_MINIO_DIR)
    public_host = os.environ.get("CIVIL_PROD_PUBLIC_HOST", "civilcitizens.ca").strip() or "civilcitizens.ca"

    print("→ Preparing remote directories")
    remote_prepare(cfg)

    print(f"→ Uploading repo to {cfg.user}@{cfg.host}:{cfg.remote_dir}")
    upload_repo(cfg)

    print("→ Starting production containers on remote host")
    script = f"""
set -euo pipefail

BASE_DIR={shlex.quote(cfg.remote_dir)}
if [ -d "$BASE_DIR/civil" ]; then
  APP_DIR="$BASE_DIR/civil"
else
  APP_DIR="$BASE_DIR"
fi

cd "$APP_DIR"

export POSTGRES_DATA_DIR={shlex.quote(data_dir + '/postgresql')}
export REDIS_DATA_DIR={shlex.quote(data_dir + '/redis')}
export MINIO_DATA_DIR={shlex.quote(minio_dir)}

cat > .env.prod-runtime <<EOF
POSTGRES_DATA_DIR={shlex.quote(data_dir + '/postgresql')}
REDIS_DATA_DIR={shlex.quote(data_dir + '/redis')}
MINIO_DATA_DIR={shlex.quote(minio_dir)}
CIVIL_PUBLIC_HOST={shlex.quote(public_host)}
MEDIA_PUBLIC_BASE_URL={shlex.quote(f'https://{public_host}/media')}
NEXT_PUBLIC_BASE_URL={shlex.quote(f'https://{public_host}')}
NEXT_PUBLIC_MEDIA_BASE_URL={shlex.quote(f'https://{public_host}/media')}
EOF

docker compose --env-file .env.prod-runtime -f docker-compose.yml --profile infra up -d --no-recreate postgres redis minio minio-setup
docker compose --env-file .env.prod-runtime -f docker-compose.yml --profile infra --profile app up -d --build --force-recreate api web worker nginx

PG_MOUNT=$(docker inspect --format '{{{{range .Mounts}}}}{{{{if eq .Destination "/var/lib/postgresql/data"}}}}{{{{.Source}}}}{{{{end}}}}{{{{end}}}}' civil-postgres-1)
if [ "$PG_MOUNT" != {shlex.quote(data_dir + '/postgresql')} ]; then
    echo "ERROR: postgres mount drift detected: $PG_MOUNT"
    exit 1
fi

echo "\\n[compose status]"
docker compose --env-file .env.prod-runtime -f docker-compose.yml ps

echo "\\n[health checks]"
for svc in api web nginx; do
    cid=$(docker compose --env-file .env.prod-runtime -f docker-compose.yml --profile infra --profile app ps -q "$svc")
    if [ -z "$cid" ]; then
        echo "$svc: missing"
        continue
    fi
    status=$(docker inspect --format '{{{{if .State.Health}}}}{{{{.State.Health.Status}}}}{{{{else}}}}{{{{.State.Status}}}}{{{{end}}}}' "$cid")
    echo "$svc: $status"
done
curl -fsS -H 'Host: dev.civilcitizens.ca' http://127.0.0.1/nginx-health >/dev/null && echo "nginx endpoint: ok" || echo "nginx endpoint: pending"
""".strip()
    remote_exec(cfg, script)

    print("\n✅ Production deploy completed.")


def remote_seed_geodata(cfg: RemoteConfig) -> None:
        local_geodata_dir = Path(os.environ.get("CIVIL_PROD_LARGEFILES_DIR", str(LOCAL_LARGEFILES_DIR))).expanduser().resolve()
        required_archives = [
                "lcd_000b21a_e.zip",
                "lcsd000b21a_e.zip",
                "lfsa000b21a_e.zip",
        ]

        if not local_geodata_dir.is_dir():
                raise RuntimeError(f"Missing local geodata directory: {local_geodata_dir}")

        missing = [name for name in required_archives if not (local_geodata_dir / name).is_file()]
        if missing:
                raise RuntimeError(
                        "Missing required local geodata archives: " + ", ".join(missing) + f" in {local_geodata_dir}"
                )

        local_archive_paths = [local_geodata_dir / name for name in required_archives]

        upload_repo_for_geodata = (
            os.environ.get("CIVIL_PROD_GEODATA_UPLOAD_REPO", "").strip().lower() in {"1", "true", "yes"}
        )

        print("→ Preparing remote directories")
        remote_prepare(cfg)

        if upload_repo_for_geodata:
            print(f"→ Uploading repo to {cfg.user}@{cfg.host}:{cfg.remote_dir}")
            upload_repo(cfg)
        else:
            print("→ Skipping full repo upload for geodata run (set CIVIL_PROD_GEODATA_UPLOAD_REPO=1 to force)")

        remote_geodata_dir = f"{cfg.remote_dir.rstrip('/')}/civilcitizens_largefiles/_geodata"
        print(f"→ Uploading geodata archives to {cfg.user}@{cfg.host}:{remote_geodata_dir}")
        upload_files_rsync(cfg, local_archive_paths, remote_geodata_dir)

        print("→ Seeding PROD geodata from vendored local archives")
        script = f"""
set -euo pipefail

BASE_DIR={shlex.quote(cfg.remote_dir)}
if [ -d "$BASE_DIR/civil" ]; then
    APP_DIR="$BASE_DIR/civil"
    ROOT_DIR="$BASE_DIR"
else
    APP_DIR="$BASE_DIR"
    ROOT_DIR=$(dirname "$BASE_DIR")
fi

GEO_DIR="$ROOT_DIR/civilcitizens_largefiles/_geodata"
CD_ZIP="$GEO_DIR/lcd_000b21a_e.zip"
CSD_ZIP="$GEO_DIR/lcsd000b21a_e.zip"
FSA_ZIP="$GEO_DIR/lfsa000b21a_e.zip"

for file in "$CD_ZIP" "$CSD_ZIP" "$FSA_ZIP"; do
    if [ ! -f "$file" ]; then
        echo "ERROR: missing geodata archive: $file"
        exit 1
    fi
done

if ! command -v pnpm >/dev/null 2>&1; then
    echo "ERROR: pnpm is not installed on the remote host. Install pnpm (Node/Corepack) and rerun."
    exit 1
fi

cd "$APP_DIR"

echo "Using archives:"
ls -lh "$CD_ZIP" "$CSD_ZIP" "$FSA_ZIP"

export STATSCAN_CD_ZIP="$CD_ZIP"
export STATSCAN_CSD_ZIP="$CSD_ZIP"
export STATSCAN_FSA_ZIP="$FSA_ZIP"

pnpm --filter @civil/api seed:admin
pnpm --filter @civil/api link:cities-subdivisions

echo "\nGeodata seed complete."
""".strip()
        remote_exec(cfg, script)

        print("\n✅ Production geodata seeded from vendored archives.")


def main(argv: list[str]) -> int:
    cfg = resolve_remote_config()
    sub = argv[0] if argv else "deploy"

    if sub in {"check", "doctor"}:
        remote_check(cfg)
        return 0
    if sub in {"prep", "prepare"}:
        remote_prepare(cfg)
        return 0
    if sub in {"deploy", "sync", "upload"}:
        remote_deploy(cfg)
        return 0
    if sub in {"seed-geodata", "geodata", "seed_geodata"}:
        remote_seed_geodata(cfg)
        return 0
    if sub in {"ssh", "shell"}:
        os.execvp("ssh", _ssh_base(cfg))

    print("Usage: python3 _PROD.py [check|prep|deploy|seed-geodata|ssh]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
