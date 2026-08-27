import {
  parsePublicShareState,
  shareCreateResponseSchema,
  shareMutationResponseSchema,
  shareProblemSchema,
  type PublicShareState,
  type ShareCreateResponse,
  type ShareMutationResponse,
  type ShareProblem,
  type ShareSnapshot,
} from "./share.js";

type ShareClientErrorOptions = {
  status?: number;
  currentVersion?: number;
  cause?: unknown;
};

export class ShareClientError extends Error {
  readonly status: number;
  readonly currentVersion?: number;

  constructor(
    readonly code: ShareProblem["error"] | "invalid_response" | "network_error",
    message: string,
    options: ShareClientErrorOptions = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ShareClientError";
    this.status = options.status ?? 0;
    this.currentVersion = options.currentVersion;
  }
}

const SHARE_REQUEST_TIMEOUT_MS = 10_000;

function apiPath(shareId: string, suffix = ""): string {
  return `/api/v1/shares/${encodeURIComponent(shareId)}${suffix}`;
}

async function requestWithTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  upstream?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(upstream?.reason);
  if (upstream?.aborted) forwardAbort();
  else upstream?.addEventListener("abort", forwardAbort, { once: true });

  const timer = globalThis.setTimeout(() => {
    controller.abort(
      new DOMException("The sharing request timed out.", "TimeoutError"),
    );
  }, SHARE_REQUEST_TIMEOUT_MS);

  try {
    return await request(controller.signal);
  } finally {
    globalThis.clearTimeout(timer);
    upstream?.removeEventListener("abort", forwardAbort);
  }
}

async function decodeJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new ShareClientError(
      "invalid_response",
      "The sharing service returned an unreadable response.",
      { status: response.status, cause },
    );
  }
}

async function expectResponse<T>(
  request: (signal: AbortSignal) => Promise<Response>,
  parse: (input: unknown) => T | null,
  upstream?: AbortSignal,
): Promise<T> {
  try {
    return await requestWithTimeout(async (signal) => {
      const response = await request(signal);
      const body = await decodeJson(response, signal);
      if (!response.ok) {
        const decoded = shareProblemSchema.safeParse(body);
        const problem = decoded.success ? decoded.data : null;
        throw new ShareClientError(
          problem?.error ?? "invalid_response",
          problem?.message ?? "The sharing request failed.",
          {
            status: response.status,
            currentVersion: problem?.currentVersion,
          },
        );
      }
      const parsed = parse(body);
      if (!parsed) {
        throw new ShareClientError(
          "invalid_response",
          "The sharing service returned an invalid response.",
          { status: response.status },
        );
      }
      return parsed;
    }, upstream);
  } catch (cause) {
    if (cause instanceof ShareClientError) throw cause;
    throw new ShareClientError(
      "network_error",
      "The sharing service could not be reached.",
      { cause },
    );
  }
}

const fetchOptions = {
  cache: "no-store" as const,
  credentials: "same-origin" as const,
  referrerPolicy: "no-referrer" as const,
};

export function createGameShare(
  snapshot: ShareSnapshot,
  signal?: AbortSignal,
): Promise<ShareCreateResponse> {
  return expectResponse(
    (requestSignal) =>
      fetch("/api/v1/shares", {
        ...fetchOptions,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot }),
        signal: requestSignal,
      }),
    (input) => {
      const result = shareCreateResponseSchema.safeParse(input);
      return result.success ? result.data : null;
    },
    signal,
  );
}

type PublishGameShareOptions = {
  shareId: string;
  hostToken: string;
  version: number;
  snapshot: ShareSnapshot;
  signal?: AbortSignal;
};

export function publishGameShare({
  shareId,
  hostToken,
  version,
  snapshot,
  signal,
}: PublishGameShareOptions): Promise<ShareMutationResponse> {
  return expectResponse(
    (requestSignal) =>
      fetch(apiPath(shareId), {
        ...fetchOptions,
        method: "PUT",
        headers: {
          Authorization: `Bearer ${hostToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ version, snapshot }),
        signal: requestSignal,
      }),
    (input) => {
      const result = shareMutationResponseSchema.safeParse(input);
      return result.success ? result.data : null;
    },
    signal,
  );
}

type HostMutationOptions = {
  shareId: string;
  hostToken: string;
  method: "POST" | "DELETE";
  suffix?: string;
  signal?: AbortSignal;
};

function mutateGameShare({
  shareId,
  hostToken,
  method,
  suffix = "",
  signal,
}: HostMutationOptions): Promise<ShareMutationResponse> {
  return expectResponse(
    (requestSignal) =>
      fetch(apiPath(shareId, suffix), {
        ...fetchOptions,
        method,
        headers: { Authorization: `Bearer ${hostToken}` },
        signal: requestSignal,
      }),
    (input) => {
      const result = shareMutationResponseSchema.safeParse(input);
      return result.success ? result.data : null;
    },
    signal,
  );
}

export function heartbeatGameShare(
  shareId: string,
  hostToken: string,
  signal?: AbortSignal,
): Promise<ShareMutationResponse> {
  return mutateGameShare({
    shareId,
    hostToken,
    method: "POST",
    suffix: "/heartbeat",
    signal,
  });
}

export function revokeGameShare(
  shareId: string,
  hostToken: string,
  signal?: AbortSignal,
): Promise<ShareMutationResponse> {
  return mutateGameShare({ shareId, hostToken, method: "DELETE", signal });
}

export function fetchSharedGame(
  shareId: string,
  signal?: AbortSignal,
): Promise<PublicShareState> {
  return expectResponse(
    (requestSignal) =>
      fetch(apiPath(shareId), {
        ...fetchOptions,
        signal: requestSignal,
      }),
    parsePublicShareState,
    signal,
  );
}
