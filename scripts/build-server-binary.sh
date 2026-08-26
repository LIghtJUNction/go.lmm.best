#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly REPO_ROOT
readonly ENTRY_ARG="${1:-server/index.ts}"
readonly OUTPUT_ARG="${2:-dist/server/go-lmm-best-api}"

if ! command -v bun >/dev/null 2>&1; then
  printf 'error: Bun is required but was not found in PATH\n' >&2
  exit 127
fi

if ! command -v sha256sum >/dev/null 2>&1; then
  printf 'error: sha256sum is required but was not found in PATH\n' >&2
  exit 127
fi

if [[ "$ENTRY_ARG" = /* ]]; then
  readonly ENTRY="$ENTRY_ARG"
else
  readonly ENTRY="$REPO_ROOT/$ENTRY_ARG"
fi

if [[ "$OUTPUT_ARG" = /* ]]; then
  readonly OUTPUT="$OUTPUT_ARG"
else
  readonly OUTPUT="$REPO_ROOT/$OUTPUT_ARG"
fi

if [[ ! -f "$ENTRY" ]]; then
  printf 'error: server entry point does not exist: %s\n' "$ENTRY" >&2
  exit 2
fi

OUTPUT_DIR="$(dirname -- "$OUTPUT")"
readonly OUTPUT_DIR
OUTPUT_NAME="$(basename -- "$OUTPUT")"
readonly OUTPUT_NAME
mkdir -p -- "$OUTPUT_DIR"

TMP_DIR="$(mktemp -d -- "$OUTPUT_DIR/.${OUTPUT_NAME}.build.XXXXXX")"
cleanup() {
  rm -rf -- "$TMP_DIR"
}
trap cleanup EXIT INT TERM

readonly TMP_BINARY="$TMP_DIR/$OUTPUT_NAME"
readonly TMP_CHECKSUM="$TMP_DIR/$OUTPUT_NAME.sha256"

printf 'Building %s with %s\n' "$ENTRY" "$(bun --version)"
bun build "$ENTRY" \
  --compile \
  --target=bun-linux-x64-baseline \
  --outfile "$TMP_BINARY"

chmod 0755 -- "$TMP_BINARY"
(
  cd -- "$TMP_DIR"
  sha256sum -- "$OUTPUT_NAME" > "$TMP_CHECKSUM"
)

# TMP_DIR is created beside OUTPUT, so rename(2) publishes the binary atomically.
mv -fT -- "$TMP_BINARY" "$OUTPUT"
mv -fT -- "$TMP_CHECKSUM" "$OUTPUT.sha256"

printf 'Built %s\n' "$OUTPUT"
printf 'SHA-256: '
sha256sum -- "$OUTPUT"
