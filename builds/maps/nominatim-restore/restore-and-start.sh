#!/bin/bash
set -euo pipefail

PGDATA_DIR=${NOMINATIM_PGDATA_DIR:-/var/lib/postgresql/16/main}
BASEBACKUP_DIR=${NOMINATIM_BASEBACKUP_DIR:-/nominatim/basebackup}
ALLOW_FRESH_IMPORT=${NOMINATIM_ALLOW_FRESH_IMPORT:-false}
PBF_PATH=${PBF_PATH:-}

is_truthy() {
  case "${1,,}" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

pick_archive() {
  local candidate

  if [[ -f "${BASEBACKUP_DIR}" ]]; then
    printf '%s\n' "${BASEBACKUP_DIR}"
    return 0
  fi

  if [[ ! -d "${BASEBACKUP_DIR}" ]]; then
    return 1
  fi

  while IFS= read -r candidate; do
    if [[ -n "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done < <(find "${BASEBACKUP_DIR}" -maxdepth 1 -type f \( -name '*.tar' -o -name '*.tar.gz' -o -name '*.tgz' -o -name '*.tar.zst' \) | sort)

  return 1
}

reset_pgdata_dir() {
  mkdir -p "${PGDATA_DIR}"
  find "${PGDATA_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
}

normalize_extracted_layout() {
  local target_dir=$1

  if [[ -f "${target_dir}/PG_VERSION" ]]; then
    return 0
  fi

  shopt -s nullglob dotglob
  local entries=("${target_dir}"/*)
  shopt -u nullglob dotglob
  if [[ ${#entries[@]} -ne 1 ]]; then
    return 0
  fi

  local only_entry=${entries[0]}
  if [[ ! -d "${only_entry}" || ! -f "${only_entry}/PG_VERSION" ]]; then
    return 0
  fi

  find "${only_entry}" -mindepth 1 -maxdepth 1 -exec mv {} "${target_dir}/" \;
  rmdir "${only_entry}"
}

restore_archive_into_pgdata() {
  local archive_path=$1
  local staging_parent
  local staging_dir

  staging_parent=$(dirname "${PGDATA_DIR}")
  mkdir -p "${staging_parent}"
  staging_dir=$(mktemp -d "${staging_parent}/nominatim-restore.XXXXXX")

  cleanup_restore_staging() {
    rm -rf "${staging_dir}"
  }
  trap cleanup_restore_staging RETURN

  echo "Restoring Nominatim basebackup from ${archive_path} into ${PGDATA_DIR}"
  tar -xf "${archive_path}" -C "${staging_dir}"
  normalize_extracted_layout "${staging_dir}"

  if [[ ! -f "${staging_dir}/PG_VERSION" ]]; then
    echo "Basebackup restore finished but PG_VERSION was not found in extracted data from ${archive_path}." >&2
    return 1
  fi

  reset_pgdata_dir
  shopt -s nullglob dotglob
  local staged_entries=("${staging_dir}"/*)
  shopt -u nullglob dotglob
  if [[ ${#staged_entries[@]} -eq 0 ]]; then
    echo "Basebackup restore produced no PostgreSQL data files from ${archive_path}." >&2
    return 1
  fi

  mv "${staged_entries[@]}" "${PGDATA_DIR}/"
  chown -R postgres:postgres "${PGDATA_DIR}"
}

ensure_fresh_import_ready() {
  if ! is_truthy "${ALLOW_FRESH_IMPORT}"; then
    return 1
  fi

  if [[ -z "${PBF_PATH}" || ! -s "${PBF_PATH}" ]]; then
    echo "Fresh import was allowed, but PBF_PATH is not set to a readable non-empty file: ${PBF_PATH:-<unset>}" >&2
    return 1
  fi

  echo "No usable Nominatim basebackup found; proceeding with fresh import from ${PBF_PATH}."
  reset_pgdata_dir
  chown -R postgres:postgres "${PGDATA_DIR}"
}

restore_basebackup_if_needed() {
  local archive_path

  mkdir -p "${PGDATA_DIR}"

  if [[ -f "${PGDATA_DIR}/PG_VERSION" ]]; then
    echo "Detected existing Nominatim PGDATA at ${PGDATA_DIR}; skipping basebackup restore."
    return 0
  fi

  if ! archive_path=$(pick_archive); then
    echo "No Nominatim basebackup archive found in ${BASEBACKUP_DIR}." >&2
    echo "Provide a non-empty basebackup archive or set NOMINATIM_ALLOW_FRESH_IMPORT=true to import from the mounted PBF." >&2
    ensure_fresh_import_ready
    return $?
  fi

  if [[ ! -s "${archive_path}" ]]; then
    echo "Nominatim basebackup archive is empty: ${archive_path}" >&2
    echo "Provide a valid basebackup archive or set NOMINATIM_ALLOW_FRESH_IMPORT=true to import from the mounted PBF." >&2
    ensure_fresh_import_ready
    return $?
  fi

  restore_archive_into_pgdata "${archive_path}"
}

restore_basebackup_if_needed

exec "$@"