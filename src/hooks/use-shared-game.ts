import { useCallback, useEffect, useState } from "react";

import { ShareClientError, fetchSharedGame } from "@/lib/share-client";
import {
  parsePublicShareState,
  sharePresenceEventSchema,
  type PublicShareState,
} from "@/lib/share";

export type SharedGameStatus =
  | "loading"
  | "live"
  | "reconnecting"
  | "offline"
  | "ended"
  | "revoked"
  | "expired"
  | "not_found"
  | "error";

type SharedGameState = {
  status: SharedGameStatus;
  share: PublicShareState | null;
};

function statusForShare(share: PublicShareState): SharedGameStatus {
  if (share.hostStatus === "ended") return "ended";
  if (share.hostStatus === "offline") return "offline";
  return "live";
}

function terminalStatus(error: unknown): SharedGameStatus {
  if (!(error instanceof ShareClientError)) return "error";
  if (error.code === "share_revoked") return "revoked";
  if (error.code === "share_expired") return "expired";
  if (error.code === "share_not_found" || error.code === "invalid_share_id") {
    return "not_found";
  }
  return "error";
}

function isTerminalStatus(status: SharedGameStatus): boolean {
  return status === "revoked" || status === "expired" || status === "not_found";
}

function decodeEvent<T>(
  input: string,
  decode: (value: unknown) => T | null,
): T | null {
  try {
    return decode(JSON.parse(input) as unknown);
  } catch {
    return null;
  }
}

export function useSharedGame(shareId: string) {
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<SharedGameState>({
    status: "loading",
    share: null,
  });
  const retry = useCallback(() => setRetryKey((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    let eventSource: EventSource | null = null;
    let fallbackController: AbortController | null = null;
    let eventSequence = 0;
    const controller = new AbortController();

    const cancelFallback = () => {
      fallbackController?.abort();
      fallbackController = null;
    };
    const applySnapshot = (
      share: PublicShareState,
      status = statusForShare(share),
    ) => {
      setState((current) =>
        current.share && share.version < current.share.version
          ? current
          : { status, share },
      );
    };
    const fail = (status: SharedGameStatus) => {
      if (!active) return;
      cancelFallback();
      eventSource?.close();
      setState((current) => ({ ...current, status }));
    };

    void fetchSharedGame(shareId, controller.signal)
      .then((initialShare) => {
        if (!active) return;
        applySnapshot(initialShare);
        eventSource = new EventSource(
          `/api/v1/shares/${encodeURIComponent(shareId)}/events`,
        );
        eventSource.addEventListener("snapshot", (event) => {
          const snapshot = decodeEvent(
            (event as MessageEvent<string>).data,
            parsePublicShareState,
          );
          if (!snapshot) {
            fail("error");
            return;
          }
          eventSequence += 1;
          cancelFallback();
          applySnapshot(snapshot);
        });
        eventSource.addEventListener("presence", (event) => {
          const presence = decodeEvent(
            (event as MessageEvent<string>).data,
            (value) => {
              const parsed = sharePresenceEventSchema.safeParse(value);
              return parsed.success ? parsed.data : null;
            },
          );
          if (!presence) {
            fail("error");
            return;
          }
          eventSequence += 1;
          cancelFallback();
          setState((current) => {
            if (!current.share) return current;
            const share = {
              ...current.share,
              viewerCount: presence.viewerCount,
              hostStatus: presence.hostStatus,
              updatedAt: presence.updatedAt,
            };
            return { status: statusForShare(share), share };
          });
        });
        eventSource.addEventListener("revoked", () => fail("revoked"));
        eventSource.addEventListener("expired", () => fail("expired"));
        eventSource.onerror = () => {
          if (!active) return;
          setState((current) => ({ ...current, status: "reconnecting" }));
          cancelFallback();
          const fallback = new AbortController();
          fallbackController = fallback;
          const startedAtSequence = eventSequence;
          void fetchSharedGame(shareId, fallback.signal)
            .then((share) => {
              if (
                !active ||
                fallback.signal.aborted ||
                eventSequence !== startedAtSequence
              ) {
                return;
              }
              fallbackController = null;
              applySnapshot(
                share,
                share.hostStatus === "live"
                  ? "reconnecting"
                  : statusForShare(share),
              );
            })
            .catch((error: unknown) => {
              if (fallback.signal.aborted) return;
              fallbackController = null;
              const status = terminalStatus(error);
              if (isTerminalStatus(status)) fail(status);
            });
        };
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        fail(terminalStatus(error));
      });

    return () => {
      active = false;
      controller.abort();
      cancelFallback();
      eventSource?.close();
    };
  }, [retryKey, shareId]);

  return { state, retry };
}
