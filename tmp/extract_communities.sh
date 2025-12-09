#!/bin/bash
set -euo pipefail
src=/home/andre/projects/civilcitizens/tests/communities_dump_all.sql
out=/home/andre/projects/civilcitizens/tests/communities_20251207.sql
tables="Province|CensusDivision|CensusSubdivision|ForwardSortationArea|City"
: > "$out"
awk -v tables="$tables" -v out="$out" '
BEGIN {keep=0; header=1}
header {
  print > out
  if ($0 ~ /^-- Data for Name:/) header=0
  next
}
$0 ~ "^-- Data for Name: (" tables ")" {keep=1; print > out; next}
keep {
  print > out
  if ($0 == "\\.") keep=0
}
' "$src"
