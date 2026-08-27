import { afterEach, describe, expect, it, vi } from "vitest";

import { createGame } from "./session.js";
import { createShareSnapshot, type PublicShareState } from "./share.js";
import {
  ShareClientError,
  createGameShare,
  fetchSharedGame,
  publishGameShare,
} from "./share-client.js";

const shareId = "S".repeat(32);

function snapshot() {
  const value = createShareSnapshot(
    createGame("provider/model"),
    "playing",
    "real",
  );
  if (!value) throw new Error("snapshot missing");
  return value;
}

function publicState(): PublicShareState {
  return {
    shareId,
    version: 1,
    snapshot: snapshot(),
    createdAt: 1_800_000_000_000,
    updatedAt: 1_800_000_000_000,
    expiresAt: 1_800_604_800_000,
    hostStatus: "live",
    viewerCount: 0,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("share client", () => {
  it("creates a share and keeps the host token in the mutation response only", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json(
          {
            ...publicState(),
            hostToken: "host-token-with-at-least-thirty-two-bytes",
            sharePath: `/watch/${shareId}`,
          },
          { status: 201 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const created = await createGameShare(snapshot());
    expect(created.shareId).toBe(shareId);
    expect(created.hostToken).toHaveLength(41);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/v1/shares");
    expect(init?.method).toBe("POST");
    expect(init?.referrerPolicy).toBe("no-referrer");
    expect(JSON.parse(String(init?.body))).toEqual({ snapshot: snapshot() });
  });

  it("sends host credentials only in the authorization header", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          ok: true,
          version: 2,
          updatedAt: 1_800_000_000_100,
          expiresAt: 1_800_604_800_100,
          hostStatus: "live",
          viewerCount: 3,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await publishGameShare({
      shareId,
      hostToken: "host-token-with-at-least-thirty-two-bytes",
      version: 2,
      snapshot: snapshot(),
    });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe(`/api/v1/shares/${shareId}`);
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer host-token-with-at-least-thirty-two-bytes",
    );
    expect(path).not.toContain("host-token");
    expect(String(init?.body)).not.toContain("host-token");
  });

  it("rejects malformed success payloads and structured API problems", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(
        Response.json(
          {
            ok: false,
            error: "share_expired",
            message: "This shared game has expired.",
          },
          { status: 410 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          { ok: false, error: "attacker_controlled", message: "nope" },
          { status: 500 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSharedGame(shareId)).rejects.toMatchObject({
      name: "ShareClientError",
      code: "invalid_response",
    });
    await expect(fetchSharedGame(shareId)).rejects.toMatchObject({
      name: "ShareClientError",
      code: "share_expired",
      status: 410,
    });
    await expect(fetchSharedGame(shareId)).rejects.toMatchObject({
      name: "ShareClientError",
      code: "invalid_response",
      status: 500,
    });
  });

  it("normalizes network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(createGameShare(snapshot())).rejects.toBeInstanceOf(
      ShareClientError,
    );
    await expect(createGameShare(snapshot())).rejects.toMatchObject({
      code: "network_error",
    });
  });

  it("aborts stalled response bodies after the same bounded timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"shareId":'));
            signal?.addEventListener(
              "abort",
              () => controller.error(signal.reason),
              { once: true },
            );
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const assertion = expect(fetchSharedGame(shareId)).rejects.toMatchObject({
      code: "network_error",
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("aborts stalled requests after a bounded timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const assertion = expect(fetchSharedGame(shareId)).rejects.toMatchObject({
      code: "network_error",
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
