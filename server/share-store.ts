import { createHash, timingSafeEqual } from "node:crypto";
import { Database } from "bun:sqlite";

import {
  SHARE_HOST_OFFLINE_MS,
  SHARE_RETENTION_MS,
  parseShareSnapshot,
  type PublicShareState,
  type ShareHostStatus,
  type ShareSnapshot,
} from "../src/lib/share";

export type StoredShare = {
  shareId: string;
  tokenHash: string;
  version: number;
  snapshot: ShareSnapshot;
  createdAt: number;
  updatedAt: number;
  heartbeatAt: number;
  expiresAt: number;
  revokedAt: number | null;
};

export type StoreMutationResult =
  | { ok: true; share: StoredShare }
  | {
      ok: false;
      error:
        | "share_not_found"
        | "share_revoked"
        | "share_expired"
        | "invalid_host_token"
        | "stale_version";
      currentVersion?: number;
    };

type ShareRow = {
  share_id: string;
  token_hash: string;
  version: number;
  snapshot_json: string;
  created_at: number;
  updated_at: number;
  heartbeat_at: number;
  expires_at: number;
  revoked_at: number | null;
};

export function hashHostToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashHostToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hostStatus(share: StoredShare, now: number): ShareHostStatus {
  if (share.snapshot.view === "finished") return "ended";
  return now - share.heartbeatAt <= SHARE_HOST_OFFLINE_MS ? "live" : "offline";
}

export function toPublicShareState(
  share: StoredShare,
  now: number,
  viewerCount: number,
): PublicShareState {
  return {
    shareId: share.shareId,
    version: share.version,
    snapshot: share.snapshot,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    expiresAt: share.expiresAt,
    hostStatus: hostStatus(share, now),
    viewerCount,
  };
}

function parseRow(row: ShareRow | null): StoredShare | null {
  if (!row) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(row.snapshot_json);
  } catch (cause) {
    throw new Error(`Share ${row.share_id} contains malformed JSON`, { cause });
  }
  const snapshot = parseShareSnapshot(decoded);
  if (!snapshot)
    throw new Error(`Share ${row.share_id} contains an invalid snapshot`);
  return {
    shareId: row.share_id,
    tokenHash: row.token_hash,
    version: row.version,
    snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    heartbeatAt: row.heartbeat_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export class SqliteShareStore {
  readonly database: Database;

  constructor(path: string) {
    this.database = new Database(path, { create: true, strict: true });
    this.database.run("PRAGMA journal_mode = WAL;");
    this.database.run("PRAGMA foreign_keys = ON;");
    this.database.run("PRAGMA busy_timeout = 5000;");
    this.database.run(`
      CREATE TABLE IF NOT EXISTS shares (
        share_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        snapshot_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      )
    `);
    this.database.run(
      "CREATE INDEX IF NOT EXISTS shares_expiry_idx ON shares (expires_at)",
    );
  }

  close(): void {
    this.database.close();
  }

  create(
    shareId: string,
    tokenHash: string,
    snapshot: ShareSnapshot,
    now: number,
  ): StoredShare {
    const expiresAt = now + SHARE_RETENTION_MS;
    this.database
      .query(
        `INSERT INTO shares (
          share_id, token_hash, version, snapshot_json, created_at,
          updated_at, heartbeat_at, expires_at, revoked_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        shareId,
        tokenHash,
        JSON.stringify(snapshot),
        now,
        now,
        now,
        expiresAt,
      );
    const share = this.get(shareId);
    if (!share) throw new Error("Created share could not be read back");
    return share;
  }

  get(shareId: string): StoredShare | null {
    const row = this.database
      .query("SELECT * FROM shares WHERE share_id = ?")
      .get(shareId) as ShareRow | null;
    return parseRow(row);
  }

  countRetained(now: number): number {
    const row = this.database
      .query("SELECT COUNT(*) AS count FROM shares WHERE expires_at > ?")
      .get(now) as { count: number };
    return row.count;
  }

  publish(
    shareId: string,
    token: string,
    version: number,
    snapshot: ShareSnapshot,
    now: number,
  ): StoreMutationResult {
    return this.database.transaction(() => {
      const current = this.get(shareId);
      const error = this.mutationError(current, token, now);
      if (error) return error;
      if (!current)
        return { ok: false as const, error: "share_not_found" as const };
      if (version <= current.version) {
        return {
          ok: false as const,
          error: "stale_version" as const,
          currentVersion: current.version,
        };
      }
      const expiresAt = now + SHARE_RETENTION_MS;
      this.database
        .query(
          `UPDATE shares SET version = ?, snapshot_json = ?, updated_at = ?,
            heartbeat_at = ?, expires_at = ? WHERE share_id = ?`,
        )
        .run(version, JSON.stringify(snapshot), now, now, expiresAt, shareId);
      const share = this.get(shareId);
      if (!share) throw new Error("Published share disappeared");
      return { ok: true as const, share };
    })();
  }

  heartbeat(shareId: string, token: string, now: number): StoreMutationResult {
    return this.database.transaction(() => {
      const current = this.get(shareId);
      const error = this.mutationError(current, token, now);
      if (error) return error;
      if (!current)
        return { ok: false as const, error: "share_not_found" as const };
      if (current.snapshot.view === "finished") {
        return { ok: true as const, share: current };
      }
      const expiresAt = now + SHARE_RETENTION_MS;
      this.database
        .query(
          "UPDATE shares SET heartbeat_at = ?, expires_at = ? WHERE share_id = ?",
        )
        .run(now, expiresAt, shareId);
      const share = this.get(shareId);
      if (!share) throw new Error("Heartbeat share disappeared");
      return { ok: true as const, share };
    })();
  }

  revoke(shareId: string, token: string, now: number): StoreMutationResult {
    return this.database.transaction(() => {
      const current = this.get(shareId);
      const error = this.mutationError(current, token, now);
      if (error) return error;
      if (!current)
        return { ok: false as const, error: "share_not_found" as const };
      this.database
        .query(
          "UPDATE shares SET revoked_at = ?, updated_at = ? WHERE share_id = ?",
        )
        .run(now, now, shareId);
      const share = this.get(shareId);
      if (!share) throw new Error("Revoked share disappeared");
      return { ok: true as const, share };
    })();
  }

  expiredIds(now: number): string[] {
    return (
      this.database
        .query("SELECT share_id FROM shares WHERE expires_at <= ?")
        .all(now) as Array<{ share_id: string }>
    ).map((row) => row.share_id);
  }

  deleteExpired(now: number): number {
    return this.database
      .query("DELETE FROM shares WHERE expires_at <= ?")
      .run(now).changes;
  }

  private mutationError(
    share: StoredShare | null,
    token: string,
    now: number,
  ): Exclude<StoreMutationResult, { ok: true }> | null {
    if (!share) return { ok: false, error: "share_not_found" };
    if (share.revokedAt !== null) return { ok: false, error: "share_revoked" };
    if (share.expiresAt <= now) return { ok: false, error: "share_expired" };
    if (!tokenMatches(token, share.tokenHash)) {
      return { ok: false, error: "invalid_host_token" };
    }
    return null;
  }
}
