#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

command -v git >/dev/null || {
  echo "error: git is required" >&2
  exit 1
}
command -v gzip >/dev/null || {
  echo "error: gzip is required" >&2
  exit 1
}
command -v sha256sum >/dev/null || {
  echo "error: sha256sum is required" >&2
  exit 1
}
command -v tar >/dev/null || {
  echo "error: tar is required" >&2
  exit 1
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/.." && pwd -P)"
web_root="$repo_root/dist/web"
manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT
if [[ ${ALLOW_DIRTY_RELEASE:-0} != 1 ]]; then
  if ! git -C "$repo_root" diff --quiet ||
    ! git -C "$repo_root" diff --cached --quiet ||
    [[ -n "$(git -C "$repo_root" ls-files --others --exclude-standard -- src public index.html)" ]]; then
    echo "error: tracked changes or untracked web source make release provenance ambiguous" >&2
    exit 1
  fi
fi

commit="$(git -C "$repo_root" rev-parse HEAD)"
short="${commit:0:12}"
release_id="${1:-${short}-$(date -u +%Y%m%dT%H%M%SZ)}"

if [[ ! "$release_id" =~ ^[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo "error: release id must match <12-hex>-<UTC timestamp>" >&2
  exit 1
fi
if [[ "${release_id%%-*}" != "$short" ]]; then
  echo "error: release id prefix must match HEAD commit $short" >&2
  exit 1
fi
if [[ ! -f "$web_root/index.html" ]]; then
  echo "error: $web_root/index.html is missing; run npm run build:web first" >&2
  exit 1
fi
if [[ -e "$web_root/server" ]]; then
  echo "error: server artifacts must not be present in the web root" >&2
  exit 1
fi

rm -f "$web_root/SHA256SUMS" "$web_root/RELEASE.json" "$web_root/healthz"
printf 'ok %s\n' "$release_id" >"$web_root/healthz"
RELEASE_ID="$release_id" COMMIT="$commit" REPO_ROOT="$repo_root" node <<'NODE'
const { writeFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");
const release = {
  releaseId: process.env.RELEASE_ID,
  commit: process.env.COMMIT,
  committedAt: execFileSync(
    "git",
    ["show", "-s", "--format=%cI", process.env.COMMIT],
    { cwd: process.env.REPO_ROOT, encoding: "utf8" },
  ).trim(),
};
writeFileSync(
  join(process.env.REPO_ROOT, "dist/web/RELEASE.json"),
  `${JSON.stringify(release, null, 2)}\n`,
);
NODE
find "$web_root" -type d -exec chmod 0755 {} +
find "$web_root" -type f -exec chmod 0644 {} +
(
  cd "$web_root"
  find . -type f ! -name SHA256SUMS -print0 |
    sort -z |
    xargs -0 sha256sum >"$manifest"
  mv -f "$manifest" SHA256SUMS
  chmod 0644 SHA256SUMS
  sha256sum --check SHA256SUMS >/dev/null
)

artifact_dir="$repo_root/dist/releases"
mkdir -p "$artifact_dir"
archive="$artifact_dir/go-lmm-best-web-${release_id}.tar.gz"
rm -f "$archive" "${archive}.sha256"
source_date_epoch="$(git -C "$repo_root" show -s --format=%ct "$commit")"
tar \
  --sort=name \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  --mode='u+rwX,go+rX,go-w' \
  --mtime="@$source_date_epoch" \
  -C "$web_root" \
  -cf - . |
  gzip -n -9 >"$archive"
(
  cd "$artifact_dir"
  sha256sum "$(basename "$archive")" >"$(basename "$archive").sha256"
)
tar -tzf "$archive" >/dev/null

printf 'release_id=%s\n' "$release_id"
printf 'commit=%s\n' "$commit"
printf 'archive=%s\n' "$archive"
printf 'archive_sha256=%s\n' "$(sha256sum "$archive" | cut -d' ' -f1)"
