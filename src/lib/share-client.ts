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
} from "./share";

export class ShareClientError extends Error {
  constructor(
    readonly code: ShareProblem["error"] | "invalid_response" | "network_error",
    message: string,
    readonly status = 0,
    readonly currentVersion?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ShareClientError";
  }
}

function apiPath(shareId: string, suffix = ""): string {
  return `/api/v1/shares/${encodeURIComponent(shareId)}${suffix}`;
}

async function decodeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new ShareClientError(
      "invalid_response",
      "The sharing service returned an unreadable response.",
      response.status,
      undefined,
      { cause },
    );
  }
}

async function expectResponse<T>(
  request: Promise<Response>,
  parse: (input: unknown) => T | null,
): Promise<T> {
  let response: Response;
  try {
    response = await request;
  } catch (cause) {
    throw new ShareClientError(
      "network_error",
      "The sharing service could not be reached.",
      0,
      undefined,
      { cause },
    );
  }
  const body = await decodeJson(response);
  if (!response.ok) {
    const decoded = shareProblemSchema.safeParse(body);
    const problem = decoded.success ? decoded.data : null;
    throw new ShareClientError(
      problem?.error ?? "invalid_response",
      problem?.message ?? "The sharing request failed.",
      response.status,
      problem?.currentVersion,
    );
  }
  const parsed = parse(body);
  if (!parsed) {
    throw new ShareClientError(
      "invalid_response",
      "The sharing service returned an invalid response.",
      response.status,
    );
  }
  return parsed;
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
    fetch("/api/v1/shares", {
      ...fetchOptions,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot }),
      signal,
    }),
    (input) => {
      const result = shareCreateResponseSchema.safeParse(input);
      return result.success ? result.data : null;
    },
  );
}

export function publishGameShare(
  shareId: string,
  hostToken: string,
  version: number,
  snapshot: ShareSnapshot,
  signal?: AbortSignal,
): Promise<ShareMutationResponse> {
  return expectResponse(
    fetch(apiPath(shareId), {
      ...fetchOptions,
      method: "PUT",
      headers: {
        Authorization: `Bearer ${hostToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ version, snapshot }),
      signal,
    }),
    (input) => {
      const result = shareMutationResponseSchema.safeParse(input);
      return result.success ? result.data : null;
    },
  );
}

export function heartbeatGameShare(
  shareId: string,
  hostToken: string,
  signal?: AbortSignal,
): Promise<ShareMutationResponse> {
  return expectResponse(
    fetch(apiPath(shareId, "/heartbeat"), {
      ...fetchOptions,
      method: "POST",
      headers: { Authorization: `Bearer ${hostToken}` },
      signal,
    }),
    (input) => {
      const result = shareMutationResponseSchema.safeParse(input);
      return result.success ? result.data : null;
    },
  );
}

export function revokeGameShare(
  shareId: string,
  hostToken: string,
  signal?: AbortSignal,
): Promise<ShareMutationResponse> {
  return expectResponse(
    fetch(apiPath(shareId), {
      ...fetchOptions,
      method: "DELETE",
      headers: { Authorization: `Bearer ${hostToken}` },
      signal,
    }),
    (input) => {
      const result = shareMutationResponseSchema.safeParse(input);
      return result.success ? result.data : null;
    },
  );
}

export function fetchSharedGame(
  shareId: string,
  signal?: AbortSignal,
): Promise<PublicShareState> {
  return expectResponse(
    fetch(apiPath(shareId), { ...fetchOptions, signal }),
    parsePublicShareState,
  );
}
