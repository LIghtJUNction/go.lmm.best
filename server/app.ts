import {
  MAX_SHARE_BODY_BYTES,
  parseShareSnapshot,
  type ShareProblem,
  type ShareStreamEvent,
} from "../src/lib/share";
import {
  type ShareRelay,
  shareProblem,
  type ShareSubscriber,
  type ShareSubscriptionResult,
} from "./share-relay";

export type ShareAppOptions = {
  allowedOrigins: ReadonlySet<string>;
  now?: () => number;
  requestIp?: (request: Request) => string;
  maxSseBufferedBytes?: number;
};

type RateEntry = { count: number; resetAt: number };
type RateDecision = { allowed: boolean; resetAt: number };
const MAX_RATE_LIMIT_KEYS = 100_000;
const DEFAULT_MAX_SSE_BUFFERED_BYTES = MAX_SHARE_BODY_BYTES + 64 * 1024;

class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateEntry>();

  constructor(private readonly now: () => number) {}

  consume(key: string, limit: number, windowMs: number): RateDecision {
    const now = this.now();
    const current = this.entries.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && this.entries.size >= MAX_RATE_LIMIT_KEYS) {
        let resetAt = now + windowMs;
        for (const entry of this.entries.values()) {
          resetAt = Math.min(resetAt, entry.resetAt);
        }
        return { allowed: false, resetAt };
      }
      const resetAt = now + windowMs;
      this.entries.set(key, { count: 1, resetAt });
      return { allowed: true, resetAt };
    }
    if (current.count >= limit) {
      return { allowed: false, resetAt: current.resetAt };
    }
    current.count += 1;
    return { allowed: true, resetAt: current.resetAt };
  }

  sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function problemStatus(error: ShareProblem["error"]): number {
  switch (error) {
    case "invalid_origin":
    case "invalid_host_token":
      return 403;
    case "invalid_content_type":
      return 415;
    case "body_too_large":
      return 413;
    case "share_not_found":
      return 404;
    case "share_revoked":
    case "share_expired":
      return 410;
    case "stale_version":
      return 409;
    case "share_capacity_reached":
    case "spectator_capacity_reached":
    case "rate_limited":
      return 429;
    case "method_not_allowed":
      return 405;
    default:
      return 400;
  }
}

function problemResponse(
  problem: ShareProblem,
  headers?: HeadersInit,
): Response {
  return json(problem, problemStatus(problem.error), headers);
}

function hostToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim() ?? "";
  return token.length >= 32 && token.length <= 128 ? token : null;
}

type ShareRoute =
  | { kind: "collection" }
  | { kind: "share"; shareId: string }
  | { kind: "heartbeat"; shareId: string }
  | { kind: "events"; shareId: string };

type RatePolicy = {
  operation: "create" | "read" | "events" | "heartbeat" | "mutation";
  limit: number;
  windowMs: number;
  mutation: boolean;
};

function shareRoute(pathname: string): ShareRoute | null {
  if (pathname === "/api/v1/shares") return { kind: "collection" };
  const match = pathname.match(
    /^\/api\/v1\/shares\/([^/]+)(?:\/(heartbeat|events))?$/,
  );
  if (!match) return null;
  if (match[2] === "heartbeat") return { kind: "heartbeat", shareId: match[1] };
  if (match[2] === "events") return { kind: "events", shareId: match[1] };
  return { kind: "share", shareId: match[1] };
}

function ratePolicy(route: ShareRoute, method: string): RatePolicy | null {
  if (route.kind === "collection" && method === "POST") {
    return {
      operation: "create",
      limit: 10,
      windowMs: 60 * 60 * 1000,
      mutation: true,
    };
  }
  if (route.kind === "events" && method === "GET") {
    return {
      operation: "events",
      limit: 120,
      windowMs: 60 * 1000,
      mutation: false,
    };
  }
  if (route.kind === "heartbeat" && method === "POST") {
    return {
      operation: "heartbeat",
      limit: 120,
      windowMs: 60 * 1000,
      mutation: true,
    };
  }
  if (route.kind === "share" && method === "GET") {
    return {
      operation: "read",
      limit: 120,
      windowMs: 60 * 1000,
      mutation: false,
    };
  }
  if (route.kind === "share" && (method === "PUT" || method === "DELETE")) {
    return {
      operation: "mutation",
      limit: 120,
      windowMs: 60 * 1000,
      mutation: true,
    };
  }
  return null;
}

async function readJson(request: Request): Promise<unknown | ShareProblem> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return shareProblem("invalid_content_type");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_SHARE_BODY_BYTES
  ) {
    return shareProblem("body_too_large");
  }
  const reader = request.body?.getReader();
  if (!reader) return shareProblem("invalid_json");
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    byteLength += result.value.byteLength;
    if (byteLength > MAX_SHARE_BODY_BYTES) {
      await reader.cancel();
      return shareProblem("body_too_large");
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(decoder.decode(body)) as unknown;
  } catch {
    return shareProblem("invalid_json");
  }
}

function isProblem(value: unknown): value is ShareProblem {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok?: unknown }).ok === false
  );
}

function encodeSse(event: ShareStreamEvent): Uint8Array {
  if (event.type === "snapshot") {
    return encoder.encode(
      `id: ${event.state.version}\nevent: snapshot\ndata: ${JSON.stringify(event.state)}\n\n`,
    );
  }
  return encoder.encode(
    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

function streamShare(
  relay: ShareRelay,
  shareId: string,
  request: Request,
  maxBufferedBytes: number,
): Response {
  if (request.signal.aborted) return new Response(null, { status: 499 });

  let subscription: ShareSubscriptionResult | undefined;
  let unsubscribe: (() => void) | null = null;
  let releaseRequested = false;
  let listeningForAbort = false;
  let closed = false;

  const releaseSubscription = () => {
    releaseRequested = true;
    if (!unsubscribe) return;
    const release = unsubscribe;
    unsubscribe = null;
    queueMicrotask(release);
  };
  const removeAbortListener = () => {
    if (!listeningForAbort) return;
    listeningForAbort = false;
    request.signal.removeEventListener("abort", handleAbort);
  };
  const closeStream = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    shouldClose: boolean,
  ) => {
    if (closed) return;
    closed = true;
    removeAbortListener();
    if (shouldClose) {
      try {
        controller.close();
      } catch {
        // The browser may have already closed the stream.
      }
    }
    releaseSubscription();
  };
  let streamController: ReadableStreamDefaultController<Uint8Array> | null =
    null;
  const handleAbort = () => {
    if (streamController) closeStream(streamController, true);
  };

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        streamController = controller;
        const enqueue = (chunk: Uint8Array) => {
          if (closed) return;
          const desiredSize = controller.desiredSize;
          if (desiredSize === null || desiredSize < chunk.byteLength) {
            closeStream(controller, true);
            return;
          }
          try {
            controller.enqueue(chunk);
          } catch {
            closeStream(controller, false);
          }
        };
        const subscriber: ShareSubscriber = {
          send(event) {
            enqueue(encodeSse(event));
          },
          ping() {
            enqueue(encoder.encode(": keepalive\n\n"));
          },
          close() {
            closeStream(controller, true);
          },
        };
        subscription = relay.subscribe(shareId, subscriber);
        if (subscription.ok) {
          unsubscribe = subscription.unsubscribe;
          if (releaseRequested) releaseSubscription();
        } else {
          closeStream(controller, true);
        }
      },
      cancel() {
        if (streamController) closeStream(streamController, false);
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: maxBufferedBytes }),
  );

  if (!subscription || !subscription.ok) {
    return problemResponse(subscription ?? shareProblem("share_not_found"));
  }
  if (request.signal.aborted) handleAbort();
  else {
    listeningForAbort = true;
    request.signal.addEventListener("abort", handleAbort, { once: true });
    if (request.signal.aborted) handleAbort();
  }
  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

async function handleShareCollection(
  relay: ShareRelay,
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") {
    return problemResponse(shareProblem("method_not_allowed"), {
      Allow: "POST",
    });
  }
  const body = await readJson(request);
  if (isProblem(body)) return problemResponse(body);
  const snapshot = parseShareSnapshot(
    typeof body === "object" && body !== null && "snapshot" in body
      ? (body as { snapshot: unknown }).snapshot
      : null,
  );
  if (!snapshot) return problemResponse(shareProblem("invalid_snapshot"));
  const result = relay.create(snapshot);
  return isProblem(result) ? problemResponse(result) : json(result, 201);
}

function handleShareEvents(
  relay: ShareRelay,
  shareId: string,
  request: Request,
  maxBufferedBytes: number,
): Response {
  if (request.method !== "GET") {
    return problemResponse(shareProblem("method_not_allowed"), {
      Allow: "GET",
    });
  }
  return streamShare(relay, shareId, request, maxBufferedBytes);
}

function handleShareHeartbeat(
  relay: ShareRelay,
  shareId: string,
  request: Request,
): Response {
  if (request.method !== "POST") {
    return problemResponse(shareProblem("method_not_allowed"), {
      Allow: "POST",
    });
  }
  const token = hostToken(request);
  if (!token) return problemResponse(shareProblem("invalid_host_token"));
  const result = relay.heartbeat(shareId, token);
  return isProblem(result) ? problemResponse(result) : json(result);
}

async function handleShareResource(
  relay: ShareRelay,
  shareId: string,
  request: Request,
): Promise<Response> {
  if (request.method === "GET") {
    const result = relay.get(shareId);
    return isProblem(result) ? problemResponse(result) : json(result);
  }
  const token = hostToken(request);
  if (!token) return problemResponse(shareProblem("invalid_host_token"));
  if (request.method === "DELETE") {
    const result = relay.revoke(shareId, token);
    return isProblem(result) ? problemResponse(result) : json(result);
  }
  if (request.method !== "PUT") {
    return problemResponse(shareProblem("method_not_allowed"), {
      Allow: "GET, PUT, DELETE",
    });
  }

  const body = await readJson(request);
  if (isProblem(body)) return problemResponse(body);
  if (typeof body !== "object" || body === null) {
    return problemResponse(shareProblem("invalid_snapshot"));
  }
  const values = body as { version?: unknown; snapshot?: unknown };
  if (
    typeof values.version !== "number" ||
    !Number.isSafeInteger(values.version) ||
    values.version < 2
  ) {
    return problemResponse(shareProblem("invalid_snapshot"));
  }
  const snapshot = parseShareSnapshot(values.snapshot);
  if (!snapshot) return problemResponse(shareProblem("invalid_snapshot"));
  const result = relay.publish(shareId, token, values.version, snapshot);
  return isProblem(result) ? problemResponse(result) : json(result);
}

export function createShareApp(relay: ShareRelay, options: ShareAppOptions) {
  const now = options.now ?? Date.now;
  const requestIp = options.requestIp ?? (() => "unknown");
  const rateLimiter = new FixedWindowRateLimiter(now);
  const maxSseBufferedBytes =
    options.maxSseBufferedBytes ?? DEFAULT_MAX_SSE_BUFFERED_BYTES;
  if (!Number.isSafeInteger(maxSseBufferedBytes) || maxSseBufferedBytes <= 0) {
    throw new Error("maxSseBufferedBytes must be a positive safe integer");
  }
  let lastRateSweep = now();

  return async function handleRequest(request: Request): Promise<Response> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return json({ ok: false, error: "invalid_request_url" }, 400);
    }
    if (url.pathname === "/healthz") {
      return json({ ok: true, service: "go-lmm-best-api" });
    }
    const route = shareRoute(url.pathname);
    if (!route) return json({ ok: false, error: "not_found" }, 404);

    const currentTime = now();
    if (currentTime - lastRateSweep >= 60_000) {
      rateLimiter.sweep();
      lastRateSweep = currentTime;
    }

    const dispatch = () => {
      if (route.kind === "collection") {
        return handleShareCollection(relay, request);
      }
      if (route.kind === "events") {
        return handleShareEvents(
          relay,
          route.shareId,
          request,
          maxSseBufferedBytes,
        );
      }
      if (route.kind === "heartbeat") {
        return handleShareHeartbeat(relay, route.shareId, request);
      }
      return handleShareResource(relay, route.shareId, request);
    };
    const policy = ratePolicy(route, request.method);
    if (!policy) return dispatch();
    if (
      policy.mutation &&
      !options.allowedOrigins.has(request.headers.get("origin") ?? "")
    ) {
      return problemResponse(shareProblem("invalid_origin"));
    }
    const decision = rateLimiter.consume(
      `${policy.operation}:${requestIp(request)}`,
      policy.limit,
      policy.windowMs,
    );
    if (!decision.allowed) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((decision.resetAt - currentTime) / 1000),
      );
      return problemResponse(shareProblem("rate_limited"), {
        "Retry-After": String(retryAfterSeconds),
      });
    }
    return dispatch();
  };
}

export function sweepShareApp(relay: ShareRelay): void {
  relay.sweep();
}

export function pingShareStreams(relay: ShareRelay): void {
  relay.keepAlive();
}
