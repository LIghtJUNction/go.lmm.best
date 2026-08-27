import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { createShareApp, pingShareStreams } from "./app";
import { ShareRelay, type ShareSubscriber } from "./share-relay";
import { SqliteShareStore } from "./share-store";
import { createGame } from "../src/lib/session";
import {
  MAX_SHARE_BODY_BYTES,
  SHARE_HOST_OFFLINE_MS,
  SHARE_RETENTION_MS,
  createShareSnapshot,
  type ShareCreateResponse,
  type ShareStreamEvent,
} from "../src/lib/share";

const openRelays: ShareRelay[] = [];

afterEach(() => {
  for (const relay of openRelays.splice(0)) relay.close();
});

function snapshot() {
  const value = createShareSnapshot(
    createGame("provider/model"),
    "playing",
    "real",
  );
  if (!value) throw new Error("snapshot missing");
  return value;
}

function createHarness(options?: {
  maxSpectatorsPerShare?: number;
  maxSpectatorsGlobal?: number;
  maxStoredShares?: number;
}) {
  let now = 1_800_000_000_000;
  let idSequence = 0;
  const store = new SqliteShareStore(":memory:");
  const relay = new ShareRelay(store, {
    now: () => now,
    idFactory: () => `${String.fromCharCode(65 + idSequence++)}`.repeat(32),
    tokenFactory: () => "host-token-with-at-least-thirty-two-bytes",
    ...options,
  });
  openRelays.push(relay);
  return {
    relay,
    advance(milliseconds: number) {
      now += milliseconds;
    },
    now: () => now,
  };
}

function requireCreated(
  result: ReturnType<ShareRelay["create"]>,
): ShareCreateResponse {
  if ("ok" in result) throw new Error(result.error);
  return result;
}

function subscriber(events: ShareStreamEvent[]) {
  let closed = false;
  let pings = 0;
  const value: ShareSubscriber = {
    send(event) {
      events.push(event);
    },
    ping() {
      pings += 1;
    },
    close() {
      closed = true;
    },
  };
  return {
    value,
    closed: () => closed,
    pings: () => pings,
  };
}

describe("ShareRelay", () => {
  it("keeps host credentials private and rejects stale or unauthorized updates", () => {
    const { relay } = createHarness();
    const created = requireCreated(relay.create(snapshot()));

    expect(created.hostToken.length).toBeGreaterThanOrEqual(32);
    expect(relay.get(created.shareId)).not.toHaveProperty("hostToken");
    expect(
      relay.publish(
        created.shareId,
        "wrong-token-that-is-still-long-enough",
        2,
        snapshot(),
      ),
    ).toMatchObject({
      ok: false,
      error: "invalid_host_token",
    });
    expect(
      relay.publish(created.shareId, created.hostToken, 1, snapshot()),
    ).toEqual({
      ok: false,
      error: "stale_version",
      message: "A newer shared state already exists.",
      currentVersion: 1,
    });
    expect(
      relay.publish(created.shareId, created.hostToken, 2, snapshot()),
    ).toMatchObject({
      ok: true,
      version: 2,
    });
  });

  it("fans out snapshots, presence, offline status, keepalives, and revocation", () => {
    const { relay, advance } = createHarness();
    const created = requireCreated(relay.create(snapshot()));
    const events: ShareStreamEvent[] = [];
    const client = subscriber(events);
    const subscription = relay.subscribe(created.shareId, client.value);
    if (!subscription.ok) throw new Error(subscription.error);

    expect(relay.viewerCount(created.shareId)).toBe(1);
    expect(events[0]).toMatchObject({
      type: "snapshot",
      state: { viewerCount: 1 },
    });
    expect(events.at(-1)).toMatchObject({ type: "presence", viewerCount: 1 });

    relay.keepAlive();
    expect(client.pings()).toBe(1);
    advance(SHARE_HOST_OFFLINE_MS + 1);
    relay.sweep();
    expect(events.at(-1)).toMatchObject({
      type: "presence",
      hostStatus: "offline",
    });

    expect(relay.heartbeat(created.shareId, created.hostToken)).toMatchObject({
      ok: true,
      hostStatus: "live",
    });
    expect(events.at(-1)).toMatchObject({
      type: "presence",
      hostStatus: "live",
    });

    expect(relay.revoke(created.shareId, created.hostToken)).toMatchObject({
      ok: true,
    });
    expect(events.at(-1)).toEqual({ type: "revoked" });
    expect(client.closed()).toBe(true);
    expect(relay.viewerCount(created.shareId)).toBe(0);
  });

  it("enforces per-share and global spectator limits", () => {
    const { relay } = createHarness({
      maxSpectatorsPerShare: 1,
      maxSpectatorsGlobal: 1,
    });
    const created = requireCreated(relay.create(snapshot()));
    const first = subscriber([]);
    const second = subscriber([]);

    expect(relay.subscribe(created.shareId, first.value).ok).toBe(true);
    expect(relay.subscribe(created.shareId, second.value)).toMatchObject({
      ok: false,
      error: "spectator_capacity_reached",
    });
  });

  it("counts revoked tombstones toward retained storage capacity", () => {
    const { relay } = createHarness({ maxStoredShares: 1 });
    const created = requireCreated(relay.create(snapshot()));

    expect(relay.revoke(created.shareId, created.hostToken)).toMatchObject({
      ok: true,
    });
    expect(relay.create(snapshot())).toMatchObject({
      ok: false,
      error: "share_capacity_reached",
    });
  });

  it("expires shares seven days after their last host activity", () => {
    const { relay, advance } = createHarness();
    const created = requireCreated(relay.create(snapshot()));
    const events: ShareStreamEvent[] = [];
    const client = subscriber(events);
    const subscription = relay.subscribe(created.shareId, client.value);
    if (!subscription.ok) throw new Error(subscription.error);

    advance(SHARE_RETENTION_MS + 1);
    expect(relay.sweep()).toBe(1);
    expect(events.at(-1)).toEqual({ type: "expired" });
    expect(client.closed()).toBe(true);
    expect(relay.get(created.shareId)).toMatchObject({
      ok: false,
      error: "share_not_found",
    });
  });

  it("makes store shutdown idempotent and rejects use after close", () => {
    const store = new SqliteShareStore(":memory:");

    store.close();
    expect(() => store.close()).not.toThrow();
    expect(() => store.get("missing")).toThrow("Share store is closed");
  });

  it("restores the last snapshot after a relay restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "go-share-store-"));
    const path = join(directory, "shares.sqlite3");
    try {
      const first = new ShareRelay(new SqliteShareStore(path), {
        idFactory: () => "P".repeat(32),
        tokenFactory: () => "persistent-host-token-at-least-32-bytes",
      });
      const created = requireCreated(first.create(snapshot()));
      first.close();

      const second = new ShareRelay(new SqliteShareStore(path));
      expect(second.get(created.shareId)).toMatchObject({
        shareId: created.shareId,
        version: 1,
        snapshot: { protocolVersion: 1 },
      });
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("share HTTP API", () => {
  it("creates, reads, streams, updates, and revokes a same-origin share", async () => {
    const { relay } = createHarness();
    const app = createShareApp(relay, {
      allowedOrigins: new Set(["https://go.lmm.best"]),
      requestIp: () => "203.0.113.4",
    });
    const originHeaders = {
      "Content-Type": "application/json",
      Origin: "https://go.lmm.best",
    };
    const createResponse = await app(
      new Request("https://go.lmm.best/api/v1/shares", {
        method: "POST",
        headers: originHeaders,
        body: JSON.stringify({ snapshot: snapshot() }),
      }),
    );
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      shareId: string;
      hostToken: string;
      sharePath: string;
    };
    expect(created.sharePath).toBe(`/watch/${created.shareId}`);

    const publicResponse = await app(
      new Request(`https://go.lmm.best/api/v1/shares/${created.shareId}`),
    );
    const publicBody = await publicResponse.json();
    expect(publicBody).not.toHaveProperty("hostToken");
    expect(JSON.stringify(publicBody)).not.toContain("token_hash");

    const streamResponse = await app(
      new Request(
        `https://go.lmm.best/api/v1/shares/${created.shareId}/events`,
      ),
    );
    expect(streamResponse.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    const reader = streamResponse.body?.getReader();
    const firstChunk = await reader?.read();
    expect(new TextDecoder().decode(firstChunk?.value)).toContain(
      "event: snapshot",
    );
    await reader?.cancel();

    const updateResponse = await app(
      new Request(`https://go.lmm.best/api/v1/shares/${created.shareId}`, {
        method: "PUT",
        headers: {
          ...originHeaders,
          Authorization: `Bearer ${created.hostToken}`,
        },
        body: JSON.stringify({ version: 2, snapshot: snapshot() }),
      }),
    );
    expect(updateResponse.status).toBe(200);

    const revokeResponse = await app(
      new Request(`https://go.lmm.best/api/v1/shares/${created.shareId}`, {
        method: "DELETE",
        headers: {
          Origin: "https://go.lmm.best",
          Authorization: `Bearer ${created.hostToken}`,
        },
      }),
    );
    expect(revokeResponse.status).toBe(200);
    expect(
      await app(
        new Request(`https://go.lmm.best/api/v1/shares/${created.shareId}`),
      ),
    ).toHaveProperty("status", 410);
  });

  it("disconnects slow SSE readers before their queue grows without bound", async () => {
    const { relay } = createHarness({ maxSpectatorsPerShare: 1 });
    const app = createShareApp(relay, {
      allowedOrigins: new Set(["https://go.lmm.best"]),
      requestIp: () => "203.0.113.20",
      maxSseBufferedBytes: 4 * 1024,
    });
    const createResponse = await app(
      new Request("https://go.lmm.best/api/v1/shares", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://go.lmm.best",
        },
        body: JSON.stringify({ snapshot: snapshot() }),
      }),
    );
    const created = (await createResponse.json()) as { shareId: string };
    const eventsUrl = `https://go.lmm.best/api/v1/shares/${created.shareId}/events`;
    const streamResponse = await app(new Request(eventsUrl));
    const reader = streamResponse.body?.getReader();
    await reader?.read();
    await reader?.read();
    expect(relay.totalViewerCount()).toBe(1);

    for (let index = 0; index < 1_000; index += 1) pingShareStreams(relay);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(relay.totalViewerCount()).toBe(0);
    const replacement = await app(new Request(eventsUrl));
    expect(replacement.status).toBe(200);
    expect(relay.totalViewerCount()).toBe(1);
    await replacement.body?.cancel();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(relay.totalViewerCount()).toBe(0);
  });

  it("does not retain a spectator for an already-aborted SSE request", async () => {
    const { relay } = createHarness();
    const app = createShareApp(relay, {
      allowedOrigins: new Set(["https://go.lmm.best"]),
      requestIp: () => "203.0.113.21",
    });
    const createResponse = await app(
      new Request("https://go.lmm.best/api/v1/shares", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://go.lmm.best",
        },
        body: JSON.stringify({ snapshot: snapshot() }),
      }),
    );
    const created = (await createResponse.json()) as { shareId: string };
    const controller = new AbortController();
    controller.abort();

    const response = await app(
      new Request(
        `https://go.lmm.best/api/v1/shares/${created.shareId}/events`,
        { signal: controller.signal },
      ),
    );

    expect(response.status).toBe(499);
    expect(relay.totalViewerCount()).toBe(0);
  });

  it("rejects cross-origin mutations before parsing the body", async () => {
    const { relay } = createHarness();
    const app = createShareApp(relay, {
      allowedOrigins: new Set(["https://go.lmm.best"]),
    });
    const response = await app(
      new Request("https://go.lmm.best/api/v1/shares", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.example",
        },
        body: JSON.stringify({ snapshot: snapshot() }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "invalid_origin",
    });
  });

  it("rate limits share creation with an accurate retry window", async () => {
    const { relay, advance, now } = createHarness();
    const app = createShareApp(relay, {
      allowedOrigins: new Set(["https://go.lmm.best"]),
      requestIp: () => "203.0.113.10",
      now,
    });
    const createRequest = () =>
      new Request("https://go.lmm.best/api/v1/shares", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://go.lmm.best",
        },
        body: JSON.stringify({ snapshot: snapshot() }),
      });

    for (let index = 0; index < 10; index += 1) {
      expect((await app(createRequest())).status).toBe(201);
    }
    advance(30 * 60 * 1000);
    const response = await app(createRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("1800");
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "rate_limited",
    });
  });

  it("matches the JSON media type exactly and accepts parameters case-insensitively", async () => {
    const { relay } = createHarness();
    const app = createShareApp(relay, {
      allowedOrigins: new Set(["https://go.lmm.best"]),
      requestIp: () => "203.0.113.11",
    });
    const request = (contentType: string) =>
      new Request("https://go.lmm.best/api/v1/shares", {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          Origin: "https://go.lmm.best",
        },
        body: JSON.stringify({ snapshot: snapshot() }),
      });

    const rejected = await app(request("application/jsonp"));
    expect(rejected.status).toBe(415);
    expect(await rejected.json()).toMatchObject({
      ok: false,
      error: "invalid_content_type",
    });
    expect((await app(request("Application/JSON; Charset=UTF-8"))).status).toBe(
      201,
    );
  });

  it("accepts the case-insensitive Bearer authentication scheme", async () => {
    const { relay } = createHarness();
    const app = createShareApp(relay, {
      allowedOrigins: new Set(["https://go.lmm.best"]),
      requestIp: () => "203.0.113.12",
    });
    const createdResponse = await app(
      new Request("https://go.lmm.best/api/v1/shares", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://go.lmm.best",
        },
        body: JSON.stringify({ snapshot: snapshot() }),
      }),
    );
    const created = (await createdResponse.json()) as {
      shareId: string;
      hostToken: string;
    };

    const response = await app(
      new Request(`https://go.lmm.best/api/v1/shares/${created.shareId}`, {
        method: "DELETE",
        headers: {
          Origin: "https://go.lmm.best",
          Authorization: `bEaReR ${created.hostToken}`,
        },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("keeps public reads from consuming the host mutation budget", async () => {
    const { relay } = createHarness();
    const app = createShareApp(relay, {
      allowedOrigins: new Set(["https://go.lmm.best"]),
      requestIp: () => "203.0.113.13",
    });
    const createdResponse = await app(
      new Request("https://go.lmm.best/api/v1/shares", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://go.lmm.best",
        },
        body: JSON.stringify({ snapshot: snapshot() }),
      }),
    );
    const created = (await createdResponse.json()) as {
      shareId: string;
      hostToken: string;
    };
    const shareUrl = `https://go.lmm.best/api/v1/shares/${created.shareId}`;
    for (let index = 0; index < 120; index += 1) {
      expect((await app(new Request(shareUrl))).status).toBe(200);
    }
    expect((await app(new Request(shareUrl))).status).toBe(429);

    const update = await app(
      new Request(shareUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://go.lmm.best",
          Authorization: `Bearer ${created.hostToken}`,
        },
        body: JSON.stringify({ version: 2, snapshot: snapshot() }),
      }),
    );
    expect(update.status).toBe(200);
  });

  it("does not charge unsupported methods against a valid operation", async () => {
    const { relay } = createHarness();
    const app = createShareApp(relay, {
      allowedOrigins: new Set(["https://go.lmm.best"]),
      requestIp: () => "203.0.113.14",
    });
    const collectionUrl = "https://go.lmm.best/api/v1/shares";
    for (let index = 0; index < 20; index += 1) {
      expect((await app(new Request(collectionUrl))).status).toBe(405);
    }
    for (let index = 0; index < 10; index += 1) {
      expect(
        (
          await app(
            new Request(collectionUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Origin: "https://go.lmm.best",
              },
              body: JSON.stringify({ snapshot: snapshot() }),
            }),
          )
        ).status,
      ).toBe(201);
    }
  });

  it("stops reading a streamed body once it crosses 256 KiB", async () => {
    const { relay } = createHarness();
    const app = createShareApp(relay, {
      allowedOrigins: new Set(["https://go.lmm.best"]),
    });
    const response = await app(
      new Request("https://go.lmm.best/api/v1/shares", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://go.lmm.best",
        },
        body: "x".repeat(MAX_SHARE_BODY_BYTES + 1),
      }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "body_too_large",
    });
  });
});
