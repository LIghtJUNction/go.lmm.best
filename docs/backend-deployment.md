# Backend deployment

The API is a standalone Bun-compiled Linux x86-64 baseline binary. Production runs it as `/opt/go-lmm.best/bin/go-lmm-best-api`, stores SQLite data at `/var/lib/go-lmm.best/go.sqlite3`, and exposes it only through Nginx on `127.0.0.1:8787`.

## Build

From a clean checkout, provide the server entry point as the first argument if it is not `server/index.ts`:

```bash
./scripts/build-server-binary.sh server/index.ts dist/server/go-lmm-best-api
(cd dist/server && sha256sum --check go-lmm-best-api.sha256)
```

The target is deliberately fixed to `bun-linux-x64-baseline`. The script builds in a temporary directory beside the destination, calculates SHA-256 before publication, and atomically renames the completed executable into place.

## One-time host setup

Install the unit and non-secret environment template:

```bash
sudo install -d -o root -g root -m 0755 /opt/go-lmm.best/bin
sudo install -o root -g root -m 0644 deploy/systemd/go-lmm-best-api.service \
  /etc/systemd/system/go-lmm-best-api.service
sudo install -o root -g root -m 0600 deploy/env/go-lmm-best-api.env.example \
  /etc/go-lmm-best-api.env
sudo systemctl daemon-reload
```

The unit uses `DynamicUser=yes` with `StateDirectory=go-lmm.best`. systemd therefore creates and preserves `/var/lib/go-lmm.best` with ownership suitable for the transient service UID; do not pre-create the database as an unrelated user. The sandbox permits binding only TCP port 8787 and permits network traffic only over loopback. Keep `HOST=127.0.0.1` in the environment file.

Install the Nginx location snippet:

```bash
sudo install -o root -g root -m 0644 deploy/nginx/backend-locations.conf \
  /etc/nginx/snippets/go-lmm-best-backend-locations.conf
```

Then add this line **inside the existing TLS `server { ... }` block**, before its generic `location /` block:

```nginx
include /etc/nginx/snippets/go-lmm-best-backend-locations.conf;
```

Do not include it at `http` scope, and do not replace the existing static-asset locations. The snippet matches only `/api/` and the exact WebSocket route `/api/v1/ws`, preserves the request URI, overwrites forwarding headers from trusted Nginx values, disables proxy caching, and applies bounded body sizes and timeouts.

Validate before reloading:

```bash
sudo systemd-analyze verify /etc/systemd/system/go-lmm-best-api.service
sudo nginx -t
sudo systemctl reload nginx
```

## Atomic binary deployment

Build and transfer the binary plus its checksum to a staging directory first. On the host, run:

```bash
set -euo pipefail
release=/tmp/go-lmm-best-api.release
bin=/opt/go-lmm.best/bin/go-lmm-best-api

cd "$release"
sha256sum --check go-lmm-best-api.sha256
sudo install -o root -g root -m 0755 go-lmm-best-api "${bin}.new"
if sudo test -x "$bin"; then
  sudo cp --reflink=auto --preserve=mode,ownership,timestamps "$bin" "${bin}.previous"
fi
sudo mv -fT "${bin}.new" "$bin"
sudo systemctl restart go-lmm-best-api.service
```

`mv` is atomic because the staging name is created in the destination directory. Retain only a reviewed previous binary, and verify its checksum separately before relying on it.

## SQLite backup and permissions

Use SQLite's online backup API rather than copying a live database or its WAL files:

```bash
set -euo pipefail
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -o root -g root -m 0700 /var/backups/go-lmm.best
sudo sqlite3 /var/lib/go-lmm.best/go.sqlite3 \
  ".backup '/var/backups/go-lmm.best/go-${stamp}.sqlite3'"
sudo chmod 0600 "/var/backups/go-lmm.best/go-${stamp}.sqlite3"
sudo sqlite3 "/var/backups/go-lmm.best/go-${stamp}.sqlite3" 'PRAGMA integrity_check;'
```

The final command must print `ok`. Keep backups root-owned and outside `StateDirectory`. Do not `chown` the live database to a fixed numeric UID: a `DynamicUser` UID may differ after reboot. For a restore, record the current state-directory owner with `stat -c '%u:%g' /var/lib/go-lmm.best`, stop the service, restore through SQLite into a temporary file in the state directory, apply that recorded numeric owner and mode `0640`, remove stale `go.sqlite3-wal`/`go.sqlite3-shm`, atomically rename the restored database, then start the service.

## Verification

Run these checks after every deployment:

```bash
sudo systemctl is-active --quiet go-lmm-best-api.service
sudo systemctl show go-lmm-best-api.service \
  -p DynamicUser -p StateDirectory -p NoNewPrivileges -p ProtectSystem -p LimitNOFILE
curl --fail --silent --show-error http://127.0.0.1:8787/healthz
sudo ss -ltnp 'sport = :8787'
sudo journalctl -u go-lmm-best-api.service -n 100 --no-pager
sudo nginx -t
curl --fail --silent --show-error https://go.lmm.best/healthz
```

The `ss` output must show only `127.0.0.1:8787`, never `0.0.0.0:8787` or `[::]:8787`. The public `/healthz` check verifies the existing Nginx health endpoint; the loopback check verifies the API itself. Exercise one normal `/api/` request and a WebSocket handshake as an application-level smoke test.

## Executable rollback order

No automatic rollback job or timer is installed. If health or smoke checks fail, roll back manually in this order:

1. Capture diagnostics before changing state: `sudo systemctl status go-lmm-best-api.service --no-pager` and `sudo journalctl -u go-lmm-best-api.service -n 200 --no-pager`.
2. If the release changed the database schema, stop immediately and restore the matching verified SQLite backup first; binary rollback alone may be unsafe.
3. Replace the executable atomically and restart:

   ```bash
   set -euo pipefail
   bin=/opt/go-lmm.best/bin/go-lmm-best-api
   sudo test -x "${bin}.previous"
   sudo cp --reflink=auto --preserve=mode,ownership,timestamps \
     "${bin}.previous" "${bin}.rollback"
   sudo mv -fT "${bin}.rollback" "$bin"
   sudo systemctl restart go-lmm-best-api.service
   ```

4. Repeat the loopback API health check, `ss` bind check, logs, proxied API/WebSocket smoke tests, and `nginx -t`.
5. Roll back the Nginx include only if the proxy configuration itself caused the failure: remove the single include line, run `sudo nginx -t`, and only then reload Nginx. Static delivery remains independent throughout.

Never reload Nginx after a failed `nginx -t`, and never restore SQLite while the API process is running.
