import { useEffect, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  RadioIcon,
  RefreshCwIcon,
  Share2Icon,
  SquareIcon,
  UsersIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import type { GameShareState } from "@/hooks/use-game-share";
import type { Copy } from "@/lib/i18n";
import { writeToClipboard } from "@/lib/clipboard";

function shareErrorMessage(t: Copy, error: GameShareState["error"]): string {
  if (error === "network_error") return t.shareErrorNetwork;
  if (
    error === "share_capacity_reached" ||
    error === "spectator_capacity_reached" ||
    error === "rate_limited"
  ) {
    return t.shareErrorCapacity;
  }
  return t.shareErrorGeneric;
}

function activeStatusLabel(t: Copy, state: GameShareState): string {
  if (state.session?.hostStatus === "ended") return t.shareEnded;
  if (state.status === "syncing") return t.shareSyncing;
  return t.shareLive;
}

function copyButtonLabel(
  t: Copy,
  status: "idle" | "copied" | "failed",
): string {
  if (status === "copied") return t.shareCopied;
  if (status === "failed") return t.shareCopyFailed;
  return t.shareCopy;
}

function idleActionLabel(t: Copy, state: GameShareState): string {
  if (state.status === "stopping") return t.shareStopping;
  if (state.status === "creating") return t.shareCreating;
  return t.shareCreate;
}

export function ShareControls({
  t,
  state,
  onCreate,
  onRetry,
  onStop,
}: {
  t: Copy;
  state: GameShareState;
  onCreate: () => Promise<string | null>;
  onRetry: () => void;
  onStop: () => Promise<boolean>;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const { session } = state;

  useEffect(() => setCopyStatus("idle"), [session?.shareUrl]);

  const copyLink = async (url: string) => {
    setCopyStatus((await writeToClipboard(url)) ? "copied" : "failed");
  };

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = window.setTimeout(() => setCopyStatus("idle"), 2800);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const createAndCopy = async () => {
    const url = await onCreate();
    if (url) await copyLink(url);
  };

  if (!session) {
    const busy = state.status === "creating" || state.status === "stopping";
    return (
      <section
        className="flex flex-col gap-3"
        aria-labelledby="share-game-title"
      >
        <div className="space-y-1">
          <h2 id="share-game-title" className="font-medium">
            {t.shareTitle}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t.shareDescription}
          </p>
        </div>
        {state.error && (
          <Alert variant="destructive">
            <RadioIcon />
            <AlertTitle>{t.errorLabel}</AlertTitle>
            <AlertDescription>
              {shareErrorMessage(t, state.error)}
            </AlertDescription>
          </Alert>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => void createAndCopy()}
          disabled={busy}
        >
          {busy ? (
            <RefreshCwIcon
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <Share2Icon data-icon="inline-start" />
          )}
          {idleActionLabel(t, state)}
        </Button>
        {state.error && (
          <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
            <RefreshCwIcon data-icon="inline-start" />
            {t.shareRetry}
          </Button>
        )}
      </section>
    );
  }

  const syncing = state.status === "syncing";
  const stopping = state.status === "stopping";
  const statusLabel = activeStatusLabel(t, state);

  return (
    <section
        className="flex flex-col gap-3"
        aria-labelledby="share-game-title"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="share-game-title" className="font-medium">
            {t.shareTitle}
          </h2>
          <p className="text-sm text-muted-foreground">{t.shareRetention}</p>
        </div>
        <Badge variant={syncing ? "outline" : "secondary"}>{statusLabel}</Badge>
      </div>

      <InputGroup>
        <InputGroupInput
          readOnly
          value={session.shareUrl}
          aria-label={t.shareLinkLabel}
          onFocus={(event) => event.currentTarget.select()}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="sm"
            variant="default"
            onClick={() => void copyLink(session.shareUrl)}
            aria-label={t.shareCopy}
          >
            {copyStatus === "copied" ? <CheckIcon /> : <CopyIcon />}
            {copyButtonLabel(t, copyStatus)}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>

      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5" aria-live="polite">
          <UsersIcon className="size-4" />
          {t.shareViewers(session.viewerCount)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void onStop()}
          disabled={stopping}
        >
          {stopping ? (
            <RefreshCwIcon
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <SquareIcon data-icon="inline-start" />
          )}
          {stopping ? t.shareStopping : t.shareStop}
        </Button>
      </div>

      {state.error && (
        <Alert variant="destructive">
          <RadioIcon />
          <AlertTitle>{t.errorLabel}</AlertTitle>
          <AlertDescription>
            {shareErrorMessage(t, state.error)}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
