import { useCallback, useEffect, useRef, useState } from "react";

import {
  ShareClientError,
  createGameShare,
  heartbeatGameShare,
  publishGameShare,
  revokeGameShare,
} from "@/lib/share-client";
import type { ShareHostStatus, ShareProblem, ShareSnapshot } from "@/lib/share";

type GameShareStatus =
  | "idle"
  | "creating"
  | "live"
  | "syncing"
  | "stopping"
  | "error";

export type GameShareSession = {
  shareId: string;
  shareUrl: string;
  version: number;
  expiresAt: number;
  viewerCount: number;
  hostStatus: ShareHostStatus;
  lastSyncedAt: number;
};

export type GameShareState = {
  status: GameShareStatus;
  session: GameShareSession | null;
  error: ShareProblem["error"] | "invalid_response" | "network_error" | null;
};

type PrivateSession = GameShareSession & { hostToken: string };

const initialState: GameShareState = {
  status: "idle",
  session: null,
  error: null,
};

async function waitUntil(
  ready: () => boolean,
  timeoutMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!ready() && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return ready();
}

function clientErrorCode(error: unknown): GameShareState["error"] {
  return error instanceof ShareClientError ? error.code : "network_error";
}

function publicSession(session: PrivateSession): GameShareSession {
  const { hostToken: _, ...value } = session;
  return value;
}

export function useGameShare(snapshot: ShareSnapshot | null) {
  const [state, setState] = useState<GameShareState>(initialState);
  const privateSessionRef = useRef<PrivateSession | null>(null);
  const pendingSnapshotRef = useRef<ShareSnapshot | null>(null);
  const lastPublishedSnapshotRef = useRef<ShareSnapshot | null>(null);
  const latestSnapshotRef = useRef(snapshot);
  latestSnapshotRef.current = snapshot;
  const publishingRef = useRef(false);
  const generationRef = useRef(0);
  const createAbortRef = useRef<AbortController | null>(null);

  const flush = useCallback(async () => {
    if (
      publishingRef.current ||
      !pendingSnapshotRef.current ||
      !privateSessionRef.current
    ) {
      return;
    }
    publishingRef.current = true;
    let recoveredStaleVersion: number | null = null;
    setState((current) => ({ ...current, status: "syncing", error: null }));
    try {
      while (true) {
        const nextSnapshot: ShareSnapshot | null = pendingSnapshotRef.current;
        if (!nextSnapshot) break;
        pendingSnapshotRef.current = null;
        const session: PrivateSession | null = privateSessionRef.current;
        if (!session) break;
        const generation = generationRef.current;
        const nextVersion = session.version + 1;
        try {
          const response = await publishGameShare({
            shareId: session.shareId,
            hostToken: session.hostToken,
            version: nextVersion,
            snapshot: nextSnapshot,
          });
          if (
            generation !== generationRef.current ||
            privateSessionRef.current !== session
          ) {
            continue;
          }
          session.version = response.version;
          session.expiresAt = response.expiresAt;
          session.viewerCount = response.viewerCount;
          session.hostStatus = response.hostStatus;
          session.lastSyncedAt = response.updatedAt;
          setState({
            status: pendingSnapshotRef.current ? "syncing" : "live",
            session: publicSession(session),
            error: null,
          });
        } catch (error) {
          if (generation !== generationRef.current) continue;
          if (
            error instanceof ShareClientError &&
            error.code === "stale_version" &&
            error.currentVersion !== undefined &&
            error.currentVersion > session.version &&
            recoveredStaleVersion !== error.currentVersion
          ) {
            session.version = error.currentVersion;
            recoveredStaleVersion = error.currentVersion;
            pendingSnapshotRef.current ??= nextSnapshot;
            continue;
          }
          pendingSnapshotRef.current ??= nextSnapshot;
          setState((current) => ({
            ...current,
            status: "error",
            error: clientErrorCode(error),
          }));
          break;
        }
      }
    } finally {
      publishingRef.current = false;
    }
  }, []);

  const create = useCallback(async (): Promise<string | null> => {
    if (!snapshot || privateSessionRef.current || createAbortRef.current)
      return null;
    const controller = new AbortController();
    createAbortRef.current = controller;
    setState({ status: "creating", session: null, error: null });
    try {
      const response = await createGameShare(snapshot, controller.signal);
      const session: PrivateSession = {
        shareId: response.shareId,
        shareUrl: new URL(
          response.sharePath,
          window.location.origin,
        ).toString(),
        hostToken: response.hostToken,
        version: response.version,
        expiresAt: response.expiresAt,
        viewerCount: response.viewerCount,
        hostStatus: response.hostStatus,
        lastSyncedAt: response.updatedAt,
      };
      privateSessionRef.current = session;
      lastPublishedSnapshotRef.current = snapshot;
      const latestSnapshot = latestSnapshotRef.current;
      if (latestSnapshot && latestSnapshot !== snapshot) {
        lastPublishedSnapshotRef.current = latestSnapshot;
        pendingSnapshotRef.current = latestSnapshot;
      }
      setState({
        status: pendingSnapshotRef.current ? "syncing" : "live",
        session: publicSession(session),
        error: null,
      });
      if (pendingSnapshotRef.current) void flush();
      return session.shareUrl;
    } catch (error) {
      if (controller.signal.aborted) return null;
      setState({
        status: "error",
        session: null,
        error: clientErrorCode(error),
      });
      return null;
    } finally {
      if (createAbortRef.current === controller) createAbortRef.current = null;
    }
  }, [snapshot]);

  const retry = useCallback(() => {
    if (!privateSessionRef.current) {
      void create();
      return;
    }
    if (snapshot) pendingSnapshotRef.current = snapshot;
    void flush();
  }, [create, flush, snapshot]);

  const stop = useCallback(async (): Promise<boolean> => {
    let session = privateSessionRef.current;
    if (!session && createAbortRef.current) {
      setState((current) => ({ ...current, status: "stopping", error: null }));
      if (!(await waitUntil(() => !createAbortRef.current))) return false;
      session = privateSessionRef.current;
    }
    if (!session) {
      pendingSnapshotRef.current = null;
      lastPublishedSnapshotRef.current = null;
      setState(initialState);
      return true;
    }
    const generation = generationRef.current;
    setState((current) => ({ ...current, status: "stopping", error: null }));
    try {
      await revokeGameShare(session.shareId, session.hostToken);
      if (generation !== generationRef.current) return true;
      generationRef.current += 1;
      privateSessionRef.current = null;
      pendingSnapshotRef.current = null;
      lastPublishedSnapshotRef.current = null;
      setState(initialState);
      return true;
    } catch (error) {
      if (generation !== generationRef.current) return false;
      if (
        error instanceof ShareClientError &&
        ["share_revoked", "share_expired", "share_not_found"].includes(
          error.code,
        )
      ) {
        generationRef.current += 1;
        privateSessionRef.current = null;
        pendingSnapshotRef.current = null;
        lastPublishedSnapshotRef.current = null;
        setState(initialState);
        return true;
      }
      setState((current) => ({
        ...current,
        status: "error",
        error: clientErrorCode(error),
      }));
      return false;
    }
  }, []);

  const detach = useCallback(async (): Promise<boolean> => {
    if (!privateSessionRef.current && createAbortRef.current) {
      setState((current) => ({ ...current, status: "stopping", error: null }));
      if (!(await waitUntil(() => !createAbortRef.current))) return false;
    }
    if (
      privateSessionRef.current &&
      snapshot &&
      snapshot !== lastPublishedSnapshotRef.current
    ) {
      lastPublishedSnapshotRef.current = snapshot;
      pendingSnapshotRef.current = snapshot;
      void flush();
    }
    if (
      !(await waitUntil(() => !publishingRef.current)) ||
      pendingSnapshotRef.current
    ) {
      return false;
    }

    generationRef.current += 1;
    createAbortRef.current?.abort();
    createAbortRef.current = null;
    privateSessionRef.current = null;
    lastPublishedSnapshotRef.current = null;
    setState(initialState);
    return true;
  }, [flush, snapshot]);

  useEffect(() => {
    const session = privateSessionRef.current;
    if (!session || !snapshot || snapshot === lastPublishedSnapshotRef.current)
      return;
    lastPublishedSnapshotRef.current = snapshot;
    pendingSnapshotRef.current = snapshot;
    void flush();
  }, [flush, snapshot]);

  useEffect(() => {
    const session = privateSessionRef.current;
    if (!session || snapshot?.view !== "playing") return;
    const generation = generationRef.current;
    const timer = window.setInterval(() => {
      void heartbeatGameShare(session.shareId, session.hostToken)
        .then((response) => {
          if (
            generation !== generationRef.current ||
            privateSessionRef.current !== session
          ) {
            return;
          }
          session.expiresAt = response.expiresAt;
          session.viewerCount = response.viewerCount;
          session.hostStatus = response.hostStatus;
          session.lastSyncedAt = response.updatedAt;
          setState((current) => ({
            ...current,
            status: current.status === "error" ? "live" : current.status,
            session: publicSession(session),
            error: null,
          }));
          if (pendingSnapshotRef.current) void flush();
        })
        .catch((error: unknown) => {
          if (generation !== generationRef.current) return;
          setState((current) => ({
            ...current,
            status: "error",
            error: clientErrorCode(error),
          }));
        });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [flush, snapshot?.view, state.session?.shareId]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      createAbortRef.current?.abort();
    },
    [],
  );

  return { state, create, retry, stop, detach };
}
