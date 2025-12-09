#!/bin/bash
set -euo pipefail
cd /home/andre/projects/civilcitizens

# Dump selected community tables from dev DB
exec docker compose -p civil_dev -f /home/andre/projects/civilcitizens/civil/docker-compose.yml \
  exec -T postgres pg_dump -U postgres --data-only --disable-triggers --encoding=UTF8 \
  --table=public."Province" \
  --table=public."CensusDivision" \
  --table=public."CensusSubdivision" \
  --table=public."ForwardSortationArea" \
  --table=public."City" \
  civil
