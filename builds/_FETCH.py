#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent
HOME = Path.home()


@dataclass(frozen=True)
class Inputs:
    civil_env_prod_runtime: Path
    civil_logo_png: Path
    capacitor_root: Path
    capacitor_config_json: Path
    capacitor_assets_dir: Path
    assets_dir: Path
    state_dir: Path
    manifest_path: Path


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def _read_env_file(env_path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' not in line:
            continue
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip()
    return env


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding='utf-8')


def _ensure_no_meteor(civil_root: Path) -> None:
    meteor_dir = civil_root / '.meteor'
    if meteor_dir.exists():
        raise RuntimeError(f"Refusing to use legacy Meteor artifacts: {meteor_dir}")


def _run(cmd: list[str], cwd: Path) -> None:
    proc = subprocess.run(cmd, cwd=str(cwd), check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed ({proc.returncode}): {' '.join(cmd)}")


def _resolve_inputs() -> Inputs:
    # builds/ lives inside the civilcitizens repo.
    # Prefer the repo root (which should contain civil/).
    civil_root = ROOT.parent.resolve()
    if not (civil_root / 'civil').exists():
        # Fallback to ~/CIVIL (legacy layout on some machines)
        civil_root = (HOME / 'CIVIL').resolve()

    _ensure_no_meteor(civil_root)

    civil_env = civil_root / 'civil' / '.env.prod-runtime'
    civil_logo = civil_root / 'civil' / 'apps' / 'web' / 'public' / 'logo.png'

    capacitor_root = ROOT / 'mobile' / 'capacitor'
    capacitor_config_json = capacitor_root / 'capacitor.config.json'
    capacitor_assets_dir = capacitor_root / 'assets'
    assets_dir = ROOT / 'mobile' / 'assets'
    state_dir = ROOT / 'mobile' / 'state'
    manifest_path = state_dir / 'fetch-manifest.json'

    missing: list[str] = []
    for p in [civil_env, civil_logo, capacitor_root, capacitor_config_json]:
        if not p.exists():
            missing.append(str(p))
    if missing:
        raise FileNotFoundError("Missing required paths:\n" + "\n".join(f"- {m}" for m in missing))

    return Inputs(
        civil_env_prod_runtime=civil_env,
        civil_logo_png=civil_logo,
        capacitor_root=capacitor_root,
        capacitor_config_json=capacitor_config_json,
        capacitor_assets_dir=capacitor_assets_dir,
        assets_dir=assets_dir,
        state_dir=state_dir,
        manifest_path=manifest_path,
    )


def _compute_inputs_manifest(inputs: Inputs) -> dict:
    return {
        "inputs": {
            "civil_env_prod_runtime": str(inputs.civil_env_prod_runtime),
            "civil_logo_png": str(inputs.civil_logo_png),
        },
        "hashes": {
            "civil_env_prod_runtime": _sha256_file(inputs.civil_env_prod_runtime),
            "civil_logo_png": _sha256_file(inputs.civil_logo_png),
        },
    }


def _load_previous_manifest(inputs: Inputs) -> dict | None:
    if not inputs.manifest_path.exists():
        return None
    try:
        return _load_json(inputs.manifest_path)
    except Exception:
        return None


def _manifest_hashes(manifest: dict | None) -> dict[str, str] | None:
    if not manifest:
        return None
    hashes = manifest.get('hashes')
    return hashes if isinstance(hashes, dict) else None


def _derive_server_url(env: dict[str, str]) -> str:
    # Prefer NEXT_PUBLIC_BASE_URL (already includes scheme).
    base = (env.get('NEXT_PUBLIC_BASE_URL') or '').strip()
    if base:
        return base
    host = (env.get('CIVIL_PUBLIC_HOST') or '').strip()
    if host:
        return f"https://{host}"
    # Final fallback matches your current prod runtime default.
    return "https://civilcitizens.ca"


def _sync_capacitor_config(inputs: Inputs, server_url: str) -> bool:
    cfg = _load_json(inputs.capacitor_config_json)
    before = json.dumps(cfg, sort_keys=True)

    cfg.setdefault('appId', 'ca.civilcitizens')
    cfg.setdefault('appName', 'Civil')
    cfg.setdefault('webDir', 'www')
    cfg['server'] = {
        **(cfg.get('server') or {}),
        'url': server_url,
        'cleartext': False,
    }

    after = json.dumps(cfg, sort_keys=True)
    if after == before:
        return False
    _write_json(inputs.capacitor_config_json, cfg)
    return True


def _sync_assets(inputs: Inputs) -> bool:
    inputs.assets_dir.mkdir(parents=True, exist_ok=True)
    dest = inputs.assets_dir / 'logo.png'
    src_hash = _sha256_file(inputs.civil_logo_png)
    if dest.exists() and _sha256_file(dest) == src_hash:
        return False
    shutil.copy2(inputs.civil_logo_png, dest)
    return True


def _sync_capacitor_asset_inputs(inputs: Inputs) -> bool:
    """Populate the Capacitor assets inputs folder from our synced logo.

    We use @capacitor/assets "Easy Mode" by writing:
    - assets/logo.png
    """

    inputs.capacitor_assets_dir.mkdir(parents=True, exist_ok=True)

    src_logo = inputs.assets_dir / 'logo.png'
    if not src_logo.exists():
        # Ensure we have a local copy even if _sync_assets was skipped earlier.
        shutil.copy2(inputs.civil_logo_png, src_logo)

    dest = inputs.capacitor_assets_dir / 'logo.png'
    src_hash = _sha256_file(src_logo)

    changed = False

    # Keep the assets folder clean so the tool doesn't interpret this as "custom mode".
    for stale in ['icon.png', 'splash.png', 'icon-only.png', 'icon-foreground.png', 'icon-background.png']:
        stale_path = inputs.capacitor_assets_dir / stale
        if stale_path.exists():
            stale_path.unlink()
            changed = True

    if dest.exists() and _sha256_file(dest) == src_hash:
        return changed

    shutil.copy2(src_logo, dest)
    return True


def _generate_capacitor_assets(inputs: Inputs) -> None:
    # Uses devDependency-installed CLI from @capacitor/assets.
    _run(['pnpm', 'assets:generate'], cwd=inputs.capacitor_root)


def main() -> int:
    try:
        inputs = _resolve_inputs()
    except Exception as e:
        print(f"FETCH error: {e}", file=sys.stderr)
        return 2

    env = _read_env_file(inputs.civil_env_prod_runtime)
    server_url = _derive_server_url(env)

    current_manifest = _compute_inputs_manifest(inputs)
    previous_manifest = _load_previous_manifest(inputs)
    previous_hashes = _manifest_hashes(previous_manifest)
    current_hashes = _manifest_hashes(current_manifest)
    inputs_unchanged = previous_hashes is not None and current_hashes is not None and previous_hashes == current_hashes

    # We still run the sync steps even if hashes match, because native config might have been
    # edited locally; steps are idempotent.
    changed_config = _sync_capacitor_config(inputs, server_url=server_url)
    changed_assets = _sync_assets(inputs)
    changed_cap_assets = _sync_capacitor_asset_inputs(inputs)

    if changed_assets or changed_cap_assets:
        try:
            _generate_capacitor_assets(inputs)
        except Exception as e:
            print(f"Warning: unable to generate native icon/splash assets: {e}", file=sys.stderr)

    # Persist manifest after successful sync.
    _write_json(
        inputs.manifest_path,
        {
            **current_manifest,
            "derived": {
                "capacitor_server_url": server_url,
            },
        },
    )

    # Keep native projects in sync with updated config/assets.
    # (This does not rebuild the app; it just propagates www + config changes.)
    try:
        _run(['pnpm', 'cap', 'sync'], cwd=inputs.capacitor_root)
    except Exception as e:
        print(f"Warning: unable to run 'pnpm cap sync': {e}", file=sys.stderr)

    if inputs_unchanged and not changed_config and not changed_assets and not changed_cap_assets:
        print("FETCH: no changes")
        return 0

    notes: list[str] = []
    if changed_config:
        notes.append("updated capacitor.config.json")
    if changed_assets:
        notes.append("synced logo.png")
    if changed_cap_assets:
        notes.append("updated capacitor asset inputs")
    if not inputs_unchanged:
        notes.append("inputs changed")
    print("FETCH: " + ", ".join(notes) if notes else "FETCH: done")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
