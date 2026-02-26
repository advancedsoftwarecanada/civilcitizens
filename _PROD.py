#!/usr/bin/env python3
"""Civil production deploy helper (local).

This script performs direct server deploys (no git runners):
- uploads the repository to the production host via rsync/scp
- optionally checks/prepares remote directories and services

Usage:
    python3 _PROD.py              # deploy (default: upload/sync only)
    python3 _PROD.py check        # remote sanity checks
    python3 _PROD.py prep         # create remote CIVIL/CIVIL_DATA dirs
    python3 _PROD.py geodata      # upload vendored StatsCan zips + seed admin geodata on PROD
    python3 _PROD.py ssh          # open interactive SSH shell
"""

import sys


def main(argv: list[str]) -> int:
    from _production_server.deploy import main as remote_main

    sub = (argv[0] if argv else "deploy").strip().lower()
    if sub in {"deploy", "sync", "upload", ""}:
        return int(remote_main(["deploy"]))
    if sub in {"check", "doctor"}:
        return int(remote_main([sub]))
    if sub in {"prep", "prepare"}:
        return int(remote_main(["prep"]))
    if sub in {"geodata", "seed-geodata", "seed_geodata"}:
        return int(remote_main(["seed-geodata"]))
    if sub in {"ssh", "shell"}:
        return int(remote_main(["ssh"]))

    print("Usage: python3 _PROD.py [check|prep|deploy|geodata|ssh]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
