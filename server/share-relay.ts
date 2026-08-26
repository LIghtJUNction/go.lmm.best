import { randomBytes } from "node:crypto";

import {
  MAX_SPECTATORS_GLOBAL,
  MAX_SPECTATORS_PER_SHARE,
  SHARE_ID_PATTERN,
  sharePath,
  type PublicShareState,
  type ShareCreateResponse,
  type ShareHostStatus,
  type ShareMutationResponse,
  type ShareProblem,
  type ShareSnapshot,
  type ShareStreamEvent,
} from "../src/lib/share";
import {
  type SqliteShareStore,
  hashHostToken,
  toPublicShareState,
  type StoreMutationResult,
  type StoredShare,
} from "./share-store";

export type ShareSubscriber = {
  send(event: ShareStreamEvent): void;
  ping(): void;
  close(): void;
};

export type ShareSubscriptionResult =
  | { ok: true; state: PublicShareState; unsubscribe: () => void }
  | ShareProblem;

export type ShareRelayOptions = {
  now?: () => number;
  idFactory?: () => string;
  tokenFactory?: () => string;
  maxStoredShares?: number;
  maxSpectatorsPerShare?: number;
  maxSpectatorsGlobal?: number;
};

const problemMessages = {
  invalid_origin: "The request origin is not allowed.",
  invalid_content_type: "The request must use application/json.",
  body_too_large: "The share snapshot is too large.",
  invalid_json: "The request body is not valid JSON.",
  invalid_snapshot: "The share snapshot is invalid.",
  invalid_share_id: "The share link is malformed.",
  share_not_found: "This shared game does not exist.",
  share_revoked: "The host stopped sharing this game.",
  share_expired: "This shared game has expired.",
  invalid_host_token: "The host token is invalid.",
  stale_version: "A newer shared state already exists.",
  share_capacity_reached: "The sharing service is at capacity.",
  spectator_capacity_reached:
    "This shared game has reached its spectator limit.",
  rate_limited: "Too many requests. Try again shortly.",
  method_not_allowed: "This method is not allowed.",
} satisfies Record<ShareProblem["error"], string>;

export function shareProblem(
  error: ShareProblem["error"],
  currentVersion?: number,
): ShareProblem {
  const problem: ShareProblem = {
    ok: false,
    error,
    message: problemMessages[error],
  };
  if (currentVersion !== undefined) problem.currentVersion = currentVersion;
  return problem;
}

function randomId(): string {
  return randomBytes(24).toString("base64url");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function availableProblem(
  share: StoredShare | null,
  now: number,
): ShareProblem | null {
  if (!share) return shareProblem("share_not_found");
  if (share.revokedAt !== null) return shareProblem("share_revoked");
  if (share.expiresAt <= now) return shareProblem("share_expired");
  return null;
}

function mutationProblem(
  result: Exclude<StoreMutationResult, { ok: true }>,
): ShareProblem {
  return shareProblem(result.error, result.currentVersion);
}

export class ShareRelay {
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly tokenFactory: () => string;
  private readonly maxStoredShares: number;
  private readonly maxSpectatorsPerShare: number;
  private readonly maxSpectatorsGlobal: number;
  private readonly subscribers = new Map<string, Set<ShareSubscriber>>();
  private readonly lastHostStatuses = new Map<string, ShareHostStatus>();
  private spectatorCount = 0;

  constructor(
    readonly store: SqliteShareStore,
    options: ShareRelayOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? randomId;
    this.tokenFactory = options.tokenFactory ?? randomToken;
    this.maxStoredShares = options.maxStoredShares ?? 10_000;
    this.maxSpectatorsPerShare =
      options.maxSpectatorsPerShare ?? MAX_SPECTATORS_PER_SHARE;
    this.maxSpectatorsGlobal =
      options.maxSpectatorsGlobal ?? MAX_SPECTATORS_GLOBAL;
  }

  create(snapshot: ShareSnapshot): ShareCreateResponse | ShareProblem {
    const now = this.now();
    if (this.store.countRetained(now) >= this.maxStoredShares) {
      return shareProblem("share_capacity_reached");
    }

    let shareId = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = this.idFactory();
      if (SHARE_ID_PATTERN.test(candidate) && !this.store.get(candidate)) {
        shareId = candidate;
        break;
      }
    }
    if (!shareId) return shareProblem("share_capacity_reached");

    const hostToken = this.tokenFactory();
    if (hostToken.length < 32) return shareProblem("share_capacity_reached");
    const share = this.store.create(
      shareId,
      hashHostToken(hostToken),
      snapshot,
      now,
    );
    const state = toPublicShareState(share, now, 0);
    return {
      ...state,
      hostToken,
      sharePath: sharePath(shareId),
    };
  }

  get(shareId: string): PublicShareState | ShareProblem {
    if (!SHARE_ID_PATTERN.test(shareId))
      return shareProblem("invalid_share_id");
    const now = this.now();
    const share = this.store.get(shareId);
    const error = availableProblem(share, now);
    if (error) return error;
    if (!share) return shareProblem("share_not_found");
    return toPublicShareState(share, now, this.viewerCount(shareId));
  }

  publish(
    shareId: string,
    token: string,
    version: number,
    snapshot: ShareSnapshot,
  ): ShareMutationResponse | ShareProblem {
    if (!SHARE_ID_PATTERN.test(shareId))
      return shareProblem("invalid_share_id");
    const now = this.now();
    const result = this.store.publish(shareId, token, version, snapshot, now);
    if (!result.ok) return mutationProblem(result);
    const state = toPublicShareState(
      result.share,
      now,
      this.viewerCount(shareId),
    );
    this.lastHostStatuses.set(shareId, state.hostStatus);
    this.broadcast(shareId, { type: "snapshot", state });
    return this.mutationResponse(state);
  }

  heartbeat(
    shareId: string,
    token: string,
  ): ShareMutationResponse | ShareProblem {
    if (!SHARE_ID_PATTERN.test(shareId))
      return shareProblem("invalid_share_id");
    const now = this.now();
    const result = this.store.heartbeat(shareId, token, now);
    if (!result.ok) return mutationProblem(result);
    const state = toPublicShareState(
      result.share,
      now,
      this.viewerCount(shareId),
    );
    const previous = this.lastHostStatuses.get(shareId);
    this.lastHostStatuses.set(shareId, state.hostStatus);
    if (previous && previous !== state.hostStatus) {
      this.broadcastPresence(shareId, state);
    }
    return this.mutationResponse(state);
  }

  revoke(shareId: string, token: string): ShareMutationResponse | ShareProblem {
    if (!SHARE_ID_PATTERN.test(shareId))
      return shareProblem("invalid_share_id");
    const now = this.now();
    const result = this.store.revoke(shareId, token, now);
    if (!result.ok) return mutationProblem(result);
    const state = toPublicShareState(
      result.share,
      now,
      this.viewerCount(shareId),
    );
    this.broadcast(shareId, { type: "revoked" });
    this.closeSubscribers(shareId);
    return this.mutationResponse(state);
  }

  subscribe(
    shareId: string,
    subscriber: ShareSubscriber,
  ): ShareSubscriptionResult {
    const state = this.get(shareId);
    if ("ok" in state && state.ok === false) return state;
    if (this.spectatorCount >= this.maxSpectatorsGlobal) {
      return shareProblem("spectator_capacity_reached");
    }
    const current = this.subscribers.get(shareId) ?? new Set<ShareSubscriber>();
    if (current.size >= this.maxSpectatorsPerShare) {
      return shareProblem("spectator_capacity_reached");
    }
    current.add(subscriber);
    this.subscribers.set(shareId, current);
    this.spectatorCount += 1;

    const share = this.store.get(shareId);
    if (!share) {
      current.delete(subscriber);
      this.spectatorCount -= 1;
      return shareProblem("share_not_found");
    }
    const nextState = toPublicShareState(
      share,
      this.now(),
      this.viewerCount(shareId),
    );
    this.lastHostStatuses.set(shareId, nextState.hostStatus);
    subscriber.send({ type: "snapshot", state: nextState });
    this.broadcastPresence(shareId, nextState);

    let active = true;
    return {
      ok: true,
      state: nextState,
      unsubscribe: () => {
        if (!active) return;
        active = false;
        const subscribers = this.subscribers.get(shareId);
        if (!subscribers?.delete(subscriber)) return;
        this.spectatorCount = Math.max(0, this.spectatorCount - 1);
        if (subscribers.size === 0) {
          this.subscribers.delete(shareId);
          this.lastHostStatuses.delete(shareId);
          return;
        }
        const currentShare = this.store.get(shareId);
        if (!currentShare) return;
        this.broadcastPresence(
          shareId,
          toPublicShareState(
            currentShare,
            this.now(),
            this.viewerCount(shareId),
          ),
        );
      },
    };
  }

  keepAlive(): void {
    for (const subscribers of this.subscribers.values()) {
      for (const subscriber of subscribers) subscriber.ping();
    }
  }

  sweep(): number {
    const now = this.now();
    for (const shareId of this.subscribers.keys()) {
      const share = this.store.get(shareId);
      if (!share || share.expiresAt <= now) {
        this.broadcast(shareId, { type: "expired" });
        this.closeSubscribers(shareId);
        continue;
      }
      if (share.revokedAt !== null) {
        this.broadcast(shareId, { type: "revoked" });
        this.closeSubscribers(shareId);
        continue;
      }
      const state = toPublicShareState(share, now, this.viewerCount(shareId));
      const previous = this.lastHostStatuses.get(shareId);
      if (previous !== state.hostStatus) {
        this.lastHostStatuses.set(shareId, state.hostStatus);
        this.broadcastPresence(shareId, state);
      }
    }
    return this.store.deleteExpired(now);
  }

  viewerCount(shareId: string): number {
    return this.subscribers.get(shareId)?.size ?? 0;
  }

  totalViewerCount(): number {
    return this.spectatorCount;
  }

  close(): void {
    for (const shareId of [...this.subscribers.keys()]) {
      this.closeSubscribers(shareId);
    }
    this.store.close();
  }

  private mutationResponse(state: PublicShareState): ShareMutationResponse {
    return {
      ok: true,
      version: state.version,
      updatedAt: state.updatedAt,
      expiresAt: state.expiresAt,
      hostStatus: state.hostStatus,
      viewerCount: state.viewerCount,
    };
  }

  private broadcastPresence(shareId: string, state: PublicShareState): void {
    this.broadcast(shareId, {
      type: "presence",
      viewerCount: state.viewerCount,
      hostStatus: state.hostStatus,
      updatedAt: state.updatedAt,
    });
  }

  private broadcast(shareId: string, event: ShareStreamEvent): void {
    const subscribers = this.subscribers.get(shareId);
    if (!subscribers) return;
    for (const subscriber of subscribers) subscriber.send(event);
  }

  private closeSubscribers(shareId: string): void {
    const subscribers = this.subscribers.get(shareId);
    if (!subscribers) return;
    this.subscribers.delete(shareId);
    this.lastHostStatuses.delete(shareId);
    this.spectatorCount = Math.max(0, this.spectatorCount - subscribers.size);
    for (const subscriber of subscribers) subscriber.close();
  }
}
