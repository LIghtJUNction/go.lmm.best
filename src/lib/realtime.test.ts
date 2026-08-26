import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationExpiredError,
  ClientClosedError,
  RealtimeClient,
  RequestTimeoutError,
  RevisionStaleError,
  realtimeWebSocketUrl,
  type RealtimeEventTarget,
  type RealtimeScheduler,
  type RealtimeSocket,
} from "./realtime.js";

class FakeScheduler implements RealtimeScheduler {
  private now = 0;
  private nextId = 1;
  private readonly tasks = new Map<
    number,
    { at: number; callback: () => void }
  >();

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  advance(ms: number): void {
    const target = this.now + ms;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      const [id, task] = next;
      this.tasks.delete(id);
      this.now = task.at;
      task.callback();
    }
    this.now = target;
  }
}

class FakeSocket implements RealtimeSocket {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: string[] = [];
  readonly close = vi.fn((code?: number, reason?: string) => {
    void code;
    void reason;
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  });

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("socket is not open");
    this.sent.push(data);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }

  message(event: unknown): void {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
  }

  remoteClose(): void {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }
}

class FakeEventTarget implements RealtimeEventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type } as Event);
    }
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function fixture(overrides: Partial<ConstructorParameters<typeof RealtimeClient>[0]> = {}) {
  const scheduler = new FakeScheduler();
  const sockets: FakeSocket[] = [];
  let nextId = 0;
  const client = new RealtimeClient({
    origin: "https://go.lmm.best/room",
    scheduler,
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    idFactory: () => `command-${++nextId}`,
    random: () => 0.5,
    reconnectBaseMs: 100,
    reconnectMaxMs: 1_000,
    heartbeatIntervalMs: 0,
    ...overrides,
  });
  return { client, scheduler, sockets };
}

describe("realtimeWebSocketUrl", () => {
  it("derives ws and wss URLs from the page origin", () => {
    expect(realtimeWebSocketUrl("https://go.lmm.best/room")).toBe(
      "wss://go.lmm.best/api/v1/ws",
    );
    expect(realtimeWebSocketUrl("http://localhost:5173/demo")).toBe(
      "ws://localhost:5173/api/v1/ws",
    );
    expect(
      realtimeWebSocketUrl("https://go.lmm.best", "/custom/socket?token=x"),
    ).toBe("wss://go.lmm.best/custom/socket?token=x");
  });
});

describe("RealtimeClient", () => {
  it("sends an envelope and resolves the request from its ACK", async () => {
    const { client, sockets } = fixture();
    sockets[0].open();

    const response = client.request<{ revision: number }>(
      "game.move",
      { x: 3, y: 4 },
      { expectedRevision: 7 },
    );
    const command = JSON.parse(sockets[0].sent[0]) as Record<string, unknown>;
    expect(command).toEqual({
      id: "command-1",
      type: "game.move",
      expectedRevision: 7,
      payload: { x: 3, y: 4 },
    });

    sockets[0].message({
      seq: 1,
      type: "ack",
      payload: { id: "command-1", ok: true, result: { revision: 8 } },
    });
    await expect(response).resolves.toEqual({ revision: 8 });
    client.close();
  });

  it("rejects requests that are not acknowledged before their timeout", async () => {
    const { client, scheduler, sockets } = fixture();
    sockets[0].open();

    const response = client.request("queue.join", {}, { timeoutMs: 25 });
    scheduler.advance(25);

    await expect(response).rejects.toBeInstanceOf(RequestTimeoutError);
    client.close();
  });

  it("reconnects with bounded exponential delay and never replays writes", async () => {
    const { client, scheduler, sockets } = fixture();
    sockets[0].open();
    const response = client.request("game.move", { x: 1, y: 1 });

    sockets[0].remoteClose();
    await expect(response).rejects.toMatchObject({ code: "connection_lost" });
    expect(sockets).toHaveLength(1);
    scheduler.advance(99);
    expect(sockets).toHaveLength(1);
    scheduler.advance(1);
    expect(sockets).toHaveLength(2);
    expect(sockets[1].sent).toEqual([]);

    client.close();
  });

  it("deduplicates and rejects out-of-order server events by sequence", () => {
    const { client, sockets } = fixture();
    sockets[0].open();
    const listener = vi.fn();
    const unsubscribe = client.subscribe("population", listener);

    sockets[0].message({ seq: 2, type: "population", payload: { online: 4 } });
    sockets[0].message({ seq: 2, type: "population", payload: { online: 5 } });
    sockets[0].message({ seq: 1, type: "population", payload: { online: 3 } });
    sockets[0].message({ seq: 3, type: "population", payload: { online: 6 } });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].payload).toEqual({ online: 6 });
    expect(client.lastSequence).toBe(3);
    unsubscribe();
    client.close();
  });

  it("maps stale revisions and publishes authentication expiry", async () => {
    const { client, sockets } = fixture();
    sockets[0].open();
    const authListener = vi.fn();
    client.onAuthenticationExpired(authListener);

    const response = client.request("game.pass", {}, { expectedRevision: 4 });
    sockets[0].message({
      seq: 1,
      type: "command.error",
      payload: {
        id: "command-1",
        error: { code: "revision_stale", message: "Read state again" },
        currentRevision: 6,
      },
    });
    const error = await response.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RevisionStaleError);
    expect(error).toMatchObject({ currentRevision: 6 });

    sockets[0].message({
      seq: 2,
      type: "auth.expired",
      payload: { message: "Sign in again" },
    });
    expect(authListener).toHaveBeenCalledWith(
      expect.any(AuthenticationExpiredError),
    );
    client.close();
  });

  it("recovers on online signals and explicit close permanently stops work", async () => {
    const scheduler = new FakeScheduler();
    const onlineTarget = new FakeEventTarget();
    const visibilityTarget = new FakeEventTarget();
    const sockets: FakeSocket[] = [];
    let online = false;
    const client = new RealtimeClient({
      origin: "https://go.lmm.best",
      scheduler,
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      onlineTarget,
      visibilityTarget,
      isOnline: () => online,
      isVisible: () => true,
      reconnectBaseMs: 100,
      random: () => 0.5,
      heartbeatIntervalMs: 0,
    });

    expect(sockets).toHaveLength(0);
    online = true;
    onlineTarget.dispatch("online");
    expect(sockets).toHaveLength(1);
    sockets[0].open();
    const response = client.request("queue.leave", {});

    client.close();
    await expect(response).rejects.toBeInstanceOf(ClientClosedError);
    scheduler.advance(10_000);
    onlineTarget.dispatch("online");
    visibilityTarget.dispatch("visibilitychange");

    expect(sockets).toHaveLength(1);
    expect(sockets[0].close).toHaveBeenCalledWith(1000, "client closed");
    expect(onlineTarget.count("online")).toBe(0);
    expect(visibilityTarget.count("visibilitychange")).toBe(0);
    expect(client.state).toBe("closed");
  });
});
