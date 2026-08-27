#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

usage() {
  echo "usage: sudo $0 <archive.tar.gz> <release-id> <archive-sha256>" >&2
}

[[ $# -eq 3 ]] || {
  usage
  exit 2
}
[[ $EUID -eq 0 ]] || {
  echo "error: run as root" >&2
  exit 1
}
for command_name in cmp curl find flock nginx python3 sha256sum sort tar; do
  command -v "$command_name" >/dev/null || {
    echo "error: $command_name is required" >&2
    exit 1
  }
done

archive="$(readlink -f -- "$1")"
release_id="$2"
expected_sha="$3"
web_root="${WEB_ROOT:-/var/www/go.lmm.best}"
releases_dir="$web_root/releases"
current_link="$web_root/current"
release_dir="$releases_dir/$release_id"
shared_assets="$web_root/shared/assets"
health_url="${HEALTH_URL:-https://go.lmm.best/healthz}"
health_attempts="${HEALTH_ATTEMPTS:-100}"
health_interval="${HEALTH_INTERVAL_SECONDS:-0.1}"

[[ "$health_attempts" =~ ^[1-9][0-9]*$ ]] || {
  echo "error: HEALTH_ATTEMPTS must be a positive integer" >&2
  exit 1
}
[[ -f "$archive" ]] || {
  echo "error: archive not found: $archive" >&2
  exit 1
}
[[ "$release_id" =~ ^[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z$ ]] || {
  echo "error: invalid release id" >&2
  exit 1
}
[[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]] || {
  echo "error: invalid archive SHA-256" >&2
  exit 1
}

mkdir -p "$releases_dir"
exec 9>"/var/lock/go-lmm-best-static-deploy.lock"
flock -n 9 || {
  echo "error: another static deployment is running" >&2
  exit 1
}

old_target="$(readlink -f "$current_link" 2>/dev/null || true)"
staging="$releases_dir/.${release_id}.staging.$$"
validation_dir="$(mktemp -d /tmp/go-lmm-best-release.XXXXXX)"
verified_archive="$validation_dir/release.tar.gz"
switched=0
finish() {
  rc=$?
  trap - EXIT INT TERM HUP
  if ((rc != 0 && switched)); then
    echo "deployment failed; restoring ${old_target:-no previous release}" >&2
    if [[ -n "$old_target" ]]; then
      ln -sfn "$old_target" "${current_link}.rollback"
      mv -Tf "${current_link}.rollback" "$current_link"
    else
      rm -f "$current_link"
    fi
  fi
  rm -rf "$staging" "$validation_dir"
  rm -f "${current_link}.next" "${current_link}.rollback"
  exit "$rc"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# Work from a root-only private copy so the supplied path cannot change between
# validation and extraction.
install -o root -g root -m 0600 "$archive" "$verified_archive"
actual_sha="$(sha256sum "$verified_archive" | cut -d' ' -f1)"
[[ "$actual_sha" == "$expected_sha" ]] || {
  echo "error: archive checksum mismatch" >&2
  exit 1
}
ARCHIVE="$verified_archive" python3 <<'PY'
import os
import tarfile
from pathlib import PurePosixPath

archive = os.environ["ARCHIVE"]
seen: set[str] = set()
with tarfile.open(archive, mode="r:gz") as bundle:
    for member in bundle.getmembers():
        path = PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts:
            raise SystemExit(f"unsafe archive path: {member.name}")
        if not (member.isfile() or member.isdir()):
            raise SystemExit(f"unsupported archive member: {member.name}")
        normalized = str(path).rstrip("/") or "."
        if normalized in seen:
            raise SystemExit(f"duplicate archive member: {member.name}")
        seen.add(normalized)
PY

verify_release() {
  local directory="$1"
  local regenerated metadata release_from_file commit_from_file
  [[ -f "$directory/index.html" && -f "$directory/healthz" &&
    -f "$directory/RELEASE.json" && -f "$directory/SHA256SUMS" ]] || {
    echo "error: release is missing required provenance files" >&2
    return 1
  }
  [[ ! -e "$directory/server" ]] || {
    echo "error: server artifacts are present in the web release" >&2
    return 1
  }
  local special_entry
  special_entry="$(
    find "$directory" -mindepth 1 ! -type f ! -type d -print -quit
  )"
  if [[ -n "$special_entry" ]]; then
    echo "error: release contains a non-regular filesystem entry" >&2
    return 1
  fi
  [[ "$(cat "$directory/healthz")" == "ok $release_id" ]] || {
    echo "error: release health provenance does not match the release id" >&2
    return 1
  }
  metadata="$(
    RELEASE_FILE="$directory/RELEASE.json" python3 <<'PY'
import json
import os
import re

with open(os.environ["RELEASE_FILE"], encoding="utf-8") as source:
    value = json.load(source)
release_id = value.get("releaseId")
commit = value.get("commit")
if not isinstance(release_id, str) or not isinstance(commit, str):
    raise SystemExit("invalid RELEASE.json")
if not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", commit):
    raise SystemExit("invalid release commit")
print(f"{release_id}\t{commit}")
PY
  )"
  IFS=$'\t' read -r release_from_file commit_from_file <<<"$metadata"
  [[ "$release_from_file" == "$release_id" ]] || {
    echo "error: RELEASE.json release id mismatch" >&2
    return 1
  }
  [[ "${commit_from_file:0:12}" == "${release_id%%-*}" ]] || {
    echo "error: release id does not match RELEASE.json commit" >&2
    return 1
  }
  regenerated="$(mktemp "$validation_dir/manifest.XXXXXX")"
  (
    cd "$directory"
    find . -type f ! -name SHA256SUMS -print0 |
      sort -z |
      xargs -0 sha256sum >"$regenerated"
  )
  cmp --silent "$regenerated" "$directory/SHA256SUMS" || {
    echo "error: release manifest does not exactly cover regular files" >&2
    diff -u "$directory/SHA256SUMS" "$regenerated" >&2 || true
    return 1
  }
  (cd "$directory" && sha256sum --check SHA256SUMS >/dev/null)
}

publish_asset_tree() {
  local source_root="$1"
  [[ -d "$source_root" ]] || return 0
  local source_file relative target temporary source_sha target_sha
  while IFS= read -r -d '' source_file; do
    relative="${source_file#"$source_root"/}"
    target="$shared_assets/$relative"
    install -d -o root -g root -m 0755 "$(dirname -- "$target")"
    if [[ -f "$target" ]]; then
      source_sha="$(sha256sum "$source_file" | cut -d' ' -f1)"
      target_sha="$(sha256sum "$target" | cut -d' ' -f1)"
      [[ "$source_sha" == "$target_sha" ]] || {
        echo "error: immutable asset collision: $relative" >&2
        return 1
      }
      continue
    fi
    temporary="${target}.new.$$"
    if ! install -o root -g root -m 0644 "$source_file" "$temporary"; then
      rm -f "$temporary"
      return 1
    fi
    if ! mv -T "$temporary" "$target"; then
      rm -f "$temporary"
      return 1
    fi
  done < <(find "$source_root" -type f -print0)
}

# Always validate the supplied archive, even if this release ID already exists.
mkdir "$staging"
tar --no-same-owner --no-same-permissions -xzf "$verified_archive" -C "$staging"
verify_release "$staging"
if [[ -d "$release_dir" ]]; then
  verify_release "$release_dir"
  cmp --silent "$staging/SHA256SUMS" "$release_dir/SHA256SUMS" || {
    echo "error: existing release differs from the verified incoming archive" >&2
    exit 1
  }
  rm -rf "$staging"
else
  chown -R root:root "$staging"
  find "$staging" -type d -exec chmod 0755 {} +
  find "$staging" -type f -exec chmod 0644 {} +
  mv -T "$staging" "$release_dir"
fi

# Publish both generations before switching HTML. Asset names are content hashes,
# so retaining them prevents old-index/new-symlink 404 races.
publish_asset_tree "${old_target:+$old_target/assets}"
publish_asset_tree "$release_dir/assets"

nginx -t
ln -sfn "$release_dir" "${current_link}.next"
switched=1
mv -Tf "${current_link}.next" "$current_link"

health=""
for _ in $(seq 1 "$health_attempts"); do
  health="$(curl --fail --silent --show-error --max-time 5 "$health_url" || true)"
  [[ "$health" == "ok $release_id" ]] && break
  sleep "$health_interval"
done
[[ "$health" == "ok $release_id" ]] || {
  echo "error: release health check did not return the active release id" >&2
  exit 1
}
[[ "$(readlink -f "$current_link")" == "$release_dir" ]]
verify_release "$release_dir"

switched=0
printf 'old_release=%s\n' "${old_target:-none}"
printf 'new_release=%s\n' "$release_dir"
printf 'archive_sha256=%s\n' "$actual_sha"
printf 'health=%s\n' "$health"
