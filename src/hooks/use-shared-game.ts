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
    const controller = new AbortController();

    const fail = (status: SharedGameStatus) => {
      if (!active) return;
      eventSource?.close();
      setState((current) => ({ ...current, status }));
    };

    void fetchSharedGame(shareId, controller.signal)
      .then((initialShare) => {
        if (!active) return;
        setState({ status: statusForShare(initialShare), share: initialShare });
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
          setState({ status: statusForShare(snapshot), share: snapshot });
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
          void fetchSharedGame(shareId)
            .then((share) => {
              if (!active) return;
              setState({
                status:
                  share.hostStatus === "live"
                    ? "reconnecting"
                    : statusForShare(share),
                share,
              });
            })
            .catch((error: unknown) => {
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
      eventSource?.close();
    };
  }, [retryKey, shareId]);

  return { state, retry };
}
