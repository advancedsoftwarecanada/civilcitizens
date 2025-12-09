# Test fixtures

Place database dumps here for the integration test runner (`_TEST.py`). Naming:

- `geodata_YYYYMMDD.sql` – optional dump containing geographic tables (data-only recommended).
- `communities_YYYYMMDD.sql` – optional dump for community/chamber data.

The runner picks the newest file matching each prefix, pipes it into Postgres, then runs Vitest.
