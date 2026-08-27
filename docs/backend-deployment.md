# Backend deployment

The API is a standalone Bun-compiled Linux x86-64 baseline binary. Production runs it as `/opt/go-lmm-best/bin/go-lmm-best-api`, stores live-share snapshots in SQLite at `/var/lib/go-lmm-best/go.sqlite3`, and exposes it only through Nginx on `127.0.0.1:8787`. The player browser remains authoritative; the service validates, stores, and fans out sanitized read-only snapshots over SSE.

## Build

From a clean checkout:

```bash
npm install
npm run build
(cd dist/server && sha256sum --check go-lmm-best-api.sha256)
```

`npm run build:server` type-checks `server/` and then calls `scripts/build-server-binary.sh server/index.ts dist/server/go-lmm-best-api`.

The target is deliberately fixed to `bun-linux-x64-baseline`. The script builds in a temporary directory beside the destination, calculates SHA-256 before publication, and atomically renames the completed executable into place.

## One-time host setup

Install the unit and non-secret environment template:

```bash
sudo install -d -o root -g root -m 0755 /opt/go-lmm-best/bin
sudo install -o root -g root -m 0644 deploy/systemd/go-lmm-best-api.service \
  /etc/systemd/system/go-lmm-best-api.service
sudo install -o root -g root -m 0600 deploy/env/go-lmm-best-api.env.example \
  /etc/go-lmm-best-api.env
sudo systemctl daemon-reload
sudo systemctl enable go-lmm-best-api.service
```

The unit uses `DynamicUser=yes` with `StateDirectory=go-lmm-best`. systemd therefore creates and preserves `/var/lib/go-lmm-best` with ownership suitable for the transient service UID; do not pre-create the database as an unrelated user. When migrating from the legacy `go-lmm.best` state directory, take a verified SQLite backup first and restore it into the new directory while the service is stopped. The sandbox permits binding only TCP port 8787 and permits network traffic only over loopback. Keep `HOST=127.0.0.1` and `APP_ORIGIN=https://go.lmm.best` in the environment file. The default limits are 50 spectators per share and 1000 SSE connections globally.

Install the Nginx security-header and backend location snippets:

```bash
sudo install -o root -g root -m 0644 deploy/nginx/security-headers.conf \
  /etc/nginx/snippets/go-lmm-best-security-headers.conf
sudo install -o root -g root -m 0644 deploy/nginx/backend-locations.conf \
  /etc/nginx/snippets/go-lmm-best-backend-locations.conf
```

Every Nginx `location` that declares any `add_header` must also include
`go-lmm-best-security-headers.conf`; Nginx stops inheriting all parent
`add_header` values as soon as a child location defines one. The tracked
`go.lmm.best.conf` and backend snippet already follow this rule.

The tracked site config already includes the backend snippet. Before first installing that config, seed its shared immutable asset store from the active release so in-flight clients cannot lose old hashed assets:

```bash
sudo install -d -o root -g root -m 0755 /var/www/go.lmm.best/shared/assets
sudo cp -a --no-clobber /var/www/go.lmm.best/current/assets/. \
  /var/www/go.lmm.best/shared/assets/
```

When integrating only the backend snippet into another site config, add this line inside the TLS `server { ... }` block before its generic `location /` block:

```nginx
include /etc/nginx/snippets/go-lmm-best-backend-locations.conf;
```

Do not include it at `http` scope. The snippet matches `/api/` and dedicated share/SSE routes. It preserves the request URI, overwrites forwarding headers from trusted Nginx values, disables caching and SSE buffering, caps bodies at 256 KiB, and disables access logging for URL paths that contain opaque share IDs. No Upgrade headers are forwarded; add a separately hardened exact WebSocket location only when matchmaking transport is implemented.

Install the reviewed host-side static release installer as part of one-time setup:

```bash
sudo install -o root -g root -m 0755 scripts/install-static-release.sh \
  /usr/local/sbin/go-lmm-best-install-static-release
```

Validate before reloading:

```bash
sudo systemd-analyze verify /etc/systemd/system/go-lmm-best-api.service
sudo nginx -t
sudo systemctl reload nginx
```

## Atomic static release deployment

Vite writes only browser assets to `dist/web`; the API binary remains isolated in
`dist/server`. Build a release archive whose health response and manifest are
bound to one immutable release ID:

```bash
release="$(git rev-parse --short=12 HEAD)-$(date -u +%Y%m%dT%H%M%SZ)"
npm run package:web-release -- "$release"
```

The packager refuses tracked changes or untracked web source, so the embedded commit cannot describe a different build. It creates `dist/releases/go-lmm-best-web-$release.tar.gz`, a sidecar SHA-256,
`RELEASE.json`, `SHA256SUMS`, and a `healthz` file containing the same release ID.
Before activation, take and independently verify the current static release,
API binary/configuration, and SQLite online backup as described below. Transfer
the archive to a root-only staging path, then run the tracked installer:

```bash
archive="/root/staging/go-lmm-best-web-$release.tar.gz"
archive_sha="$(cut -d' ' -f1 "${archive}.sha256")"
sudo /usr/local/sbin/go-lmm-best-install-static-release \
  "$archive" "$release" "$archive_sha"
```

The installer serializes deployments with `flock`, validates archive paths and both checksum layers, publishes the old and new hashed assets into the shared immutable store, extracts into the releases filesystem, switches `current` atomically, polls `/healthz`, and restores the previous symlink on failure. It does not delete the previous release or shared assets. `open_file_cache` must remain disabled so the symlink switch cannot serve a mixed old/new build. Prune shared assets only after confirming that no retained release manifest references them.

## Atomic binary deployment

Before replacing or restarting the API, prove that the configured binary path is stable in the host mount namespace. If systemd reports an active process but direct lookup fails, stop the deployment: back up `/proc/$pid/exe`, capture `namei`, `findmnt`, inode, and checksum evidence, and investigate the host filesystem. Never restart a service whose configured `ExecStart` path cannot be read.

```bash
bin=/opt/go-lmm-best/bin/go-lmm-best-api
pid="$(sudo systemctl show -p MainPID --value go-lmm-best-api.service)"
sudo test "$pid" -gt 1
sudo test -r "/proc/$pid/exe"
sudo test -x "$bin"
test "$(sudo sha256sum "$bin" | cut -d' ' -f1)" = \
  "$(sudo sha256sum "/proc/$pid/exe" | cut -d' ' -f1)"
sudo namei -l "$bin"
sudo findmnt -T "$bin"
```

Build and transfer the binary plus its checksum to a staging directory first. On the host, run:

```bash
set -euo pipefail
release=/tmp/go-lmm-best-api.release
bin=/opt/go-lmm-best/bin/go-lmm-best-api

cd "$release"
sha256sum --check go-lmm-best-api.sha256
sudo install -o root -g root -m 0755 go-lmm-best-api "${bin}.new"
if sudo test -x "$bin"; then
  current_sha="$(sudo sha256sum "$bin" | cut -d' ' -f1)"
  previous="${bin}.previous-${current_sha:0:16}"
  if ! sudo test -e "$previous"; then
    sudo cp --reflink=auto --preserve=mode,ownership,timestamps \
      "$bin" "${previous}.new"
    test "$(sudo sha256sum "${previous}.new" | cut -d' ' -f1)" = "$current_sha"
    sudo mv -fT "${previous}.new" "$previous"
  fi
fi
sudo mv -fT "${bin}.new" "$bin"
sudo systemctl enable go-lmm-best-api.service
sudo systemctl restart go-lmm-best-api.service
```

`mv` is atomic because the staging name is created in the destination directory. Previous binaries are immutable, content-addressed files; a failed or concurrent deployment cannot overwrite the last-known-good artifact. Record the chosen previous path and full checksum in the release manifest. Remove old content-addressed backups only after a newer release has passed smoke tests and an independent backup exists.

## SQLite backup and permissions

Use SQLite's online backup API rather than copying a live database or its WAL files:

```bash
set -euo pipefail
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -o root -g root -m 0700 /var/backups/go-lmm.best
sudo sqlite3 /var/lib/go-lmm-best/go.sqlite3 \
  ".backup '/var/backups/go-lmm.best/go-${stamp}.sqlite3'"
sudo chmod 0600 "/var/backups/go-lmm.best/go-${stamp}.sqlite3"
sudo sqlite3 "/var/backups/go-lmm.best/go-${stamp}.sqlite3" 'PRAGMA integrity_check;'
```

The final command must print `ok`. Keep backups root-owned and outside `StateDirectory`. Do not `chown` the live database to a fixed numeric UID: a `DynamicUser` UID may differ after reboot. For a restore, record the current state-directory owner with `stat -c '%u:%g' /var/lib/go-lmm-best`, stop the service, restore through SQLite into a temporary file in the state directory, apply that recorded numeric owner and mode `0640`, remove stale `go.sqlite3-wal`/`go.sqlite3-shm`, atomically rename the restored database, then start the service.

## Verification

Run these checks after every deployment:

```bash
sudo systemctl is-active --quiet go-lmm-best-api.service
sudo systemctl is-enabled --quiet go-lmm-best-api.service
sudo systemctl show go-lmm-best-api.service \
  -p DynamicUser -p StateDirectory -p NoNewPrivileges -p ProtectSystem -p LimitNOFILE
curl --fail --silent --show-error http://127.0.0.1:8787/healthz
sudo ss -ltnp 'sport = :8787'
sudo journalctl -u go-lmm-best-api.service -n 100 --no-pager
sudo nginx -t
curl --fail --silent --show-error https://go.lmm.best/healthz
```

The `ss` output must show only `127.0.0.1:8787`, never `0.0.0.0:8787` or `[::]:8787`. The public `/healthz` body must match the active static release ID from its `healthz` file; the loopback check verifies the API process separately. Exercise the full sharing flow as an application-level smoke test: generate a link from a live room, open it in a signed-out browser, place one stone and send one message, confirm the spectator receives both, then stop sharing and confirm the spectator receives the revoked state. Verify that the spectator page exposes no enabled board intersections and no WebMCP tools. Restart the API once in staging and confirm the last snapshot remains readable from SQLite.

## Executable rollback order

No automatic rollback job or timer is installed. If health or smoke checks fail, roll back manually in this order:

1. Capture diagnostics before changing state: `sudo systemctl status go-lmm-best-api.service --no-pager` and `sudo journalctl -u go-lmm-best-api.service -n 200 --no-pager`.
2. If the release changed the database schema, stop immediately and restore the matching verified SQLite backup first; binary rollback alone may be unsafe.
3. Replace the executable atomically and restart:

   ```bash
   set -euo pipefail
   bin=/opt/go-lmm-best/bin/go-lmm-best-api
   previous=/opt/go-lmm-best/bin/go-lmm-best-api.previous-<sha-prefix>
   expected_sha=<full-sha256-from-release-manifest>
   sudo test -x "$previous"
   test "$(sudo sha256sum "$previous" | cut -d' ' -f1)" = "$expected_sha"
   sudo cp --reflink=auto --preserve=mode,ownership,timestamps \
     "$previous" "${bin}.rollback"
   test "$(sudo sha256sum "${bin}.rollback" | cut -d' ' -f1)" = "$expected_sha"
   sudo mv -fT "${bin}.rollback" "$bin"
   sudo systemctl restart go-lmm-best-api.service
   ```

4. Repeat the loopback API health check, `ss` bind check, logs, proxied share/SSE smoke tests, and `nginx -t`.
5. Roll back the Nginx include only if the proxy configuration itself caused the failure: remove the single include line, run `sudo nginx -t`, and only then reload Nginx. Static delivery remains independent throughout.

Never reload Nginx after a failed `nginx -t`, and never restore SQLite while the API process is running.
