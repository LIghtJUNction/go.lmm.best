import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { createShareApp, pingShareStreams, sweepShareApp } from "./app";
import { ShareRelay } from "./share-relay";
import { SqliteShareStore } from "./share-store";

type LogValue = string | number | boolean | null | readonly string[];

function writeLog(
  stream: NodeJS.WriteStream,
  event: string,
  details: Record<string, LogValue> = {},
): void {
  stream.write(`${JSON.stringify({ event, ...details })}\n`);
}

function integerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const host = process.env.HOST ?? "127.0.0.1";
const port = integerEnvironment("PORT", 8787);
const configuredOrigins = process.env.APP_ORIGIN;
if (!configuredOrigins) throw new Error("APP_ORIGIN must not be empty");
const allowedOrigins = new Set(
  configuredOrigins
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean),
);
if (allowedOrigins.size === 0) throw new Error("APP_ORIGIN must not be empty");
const databasePath =
  process.env.DATABASE_PATH ?? "/var/lib/go-lmm.best/go.sqlite3";

mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
const store = new SqliteShareStore(databasePath);
const relay = new ShareRelay(store, {
  maxStoredShares: integerEnvironment("MAX_STORED_SHARES", 10_000),
  maxSpectatorsPerShare: integerEnvironment("MAX_SPECTATORS_PER_SHARE", 50),
  maxSpectatorsGlobal: integerEnvironment("MAX_SPECTATORS_GLOBAL", 1000),
});
const handleRequest = createShareApp(relay, {
  allowedOrigins,
  requestIp: (request) => request.headers.get("x-real-ip") ?? "local",
});

const server = Bun.serve({
  hostname: host,
  port,
  async fetch(request) {
    try {
      return await handleRequest(request);
    } catch (error) {
      writeLog(process.stderr, "request_error", {
        method: request.method,
        error: error instanceof Error ? error.message : "unknown_error",
      });
      return Response.json(
        { ok: false, error: "internal_error" },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  },
});

const keepAliveTimer = setInterval(() => pingShareStreams(relay), 15_000);
const sweepTimer = setInterval(() => sweepShareApp(relay), 15_000);

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  clearInterval(keepAliveTimer);
  clearInterval(sweepTimer);
  writeLog(process.stdout, "stopping", { signal });
  void server
    .stop(true)
    .catch((error: unknown) => {
      writeLog(process.stderr, "stop_error", {
        error: error instanceof Error ? error.message : "unknown_error",
      });
    })
    .finally(() => {
      relay.close();
      process.exit(0);
    });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

writeLog(process.stdout, "started", {
  address: `${server.hostname}:${server.port}`,
  allowedOrigins: [...allowedOrigins],
  databasePath,
});
