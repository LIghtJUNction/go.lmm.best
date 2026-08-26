import { useMemo, useState } from "react";
import {
  Link2OffIcon,
  LoaderCircleIcon,
  RadioIcon,
  RefreshCwIcon,
  WifiOffIcon,
} from "lucide-react";
import { LazyMotion, domAnimation } from "motion/react";

import { GameRoom, Header, SiteFooter } from "@/components/room-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useInterfacePreferences } from "@/hooks/use-interface-preferences";
import { useSharedGame, type SharedGameStatus } from "@/hooks/use-shared-game";
import { copy, type Language } from "@/lib/i18n";
import { initialLanguage, initialTheme } from "@/lib/preferences";
import { spectatorGameToGameState } from "@/lib/share";
import type { Theme } from "@/lib/session";

function roomStatus(
  status: SharedGameStatus,
): "live" | "reconnecting" | "offline" | "ended" {
  if (status === "reconnecting") return "reconnecting";
  if (status === "offline") return "offline";
  if (status === "ended") return "ended";
  return "live";
}

const noop = () => {};
const rejectMessage = () => false;

type InterfaceCopy = (typeof copy)[Language];

function terminalText(
  status: SharedGameStatus,
  t: InterfaceCopy,
): readonly [string, string] {
  if (status === "revoked") {
    return [t.spectatorRevokedTitle, t.spectatorRevokedDescription];
  }
  if (status === "expired") {
    return [t.spectatorExpiredTitle, t.spectatorExpiredDescription];
  }
  if (status === "not_found") {
    return [t.spectatorNotFoundTitle, t.spectatorNotFoundDescription];
  }
  return [t.spectatorErrorTitle, t.spectatorErrorDescription];
}

export default function SpectatorApp({ shareId }: { shareId: string }) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [danmakuEnabled, setDanmakuEnabled] = useState(false);
  const t = useMemo(() => copy[language], [language]);
  const { state, retry } = useSharedGame(shareId);

  useInterfacePreferences(language, theme, `${t.spectatorTitle} · go.lmm.best`);

  const returnHome = () => window.location.assign("/");
  const terminal =
    state.status === "revoked" ||
    state.status === "expired" ||
    state.status === "not_found" ||
    state.status === "error";

  const terminalCopy = terminalText(state.status, t);

  return (
    <LazyMotion features={domAnimation} strict>
      <div className="flex min-h-svh flex-col overflow-x-clip bg-background text-foreground">
        <Header
          t={t}
          language={language}
          theme={theme}
          webmcpStatus="unsupported"
          showWebMcpStatus={false}
          onLanguageToggle={() =>
            setLanguage((current) => (current === "zh" ? "en" : "zh"))
          }
          onThemeToggle={() =>
            setTheme((current) => (current === "light" ? "dark" : "light"))
          }
          onReturnHome={returnHome}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8">
          {state.status === "loading" && (
            <Empty className="my-10 min-h-[28rem] border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                </EmptyMedia>
                <EmptyTitle>{t.spectatorLoading}</EmptyTitle>
                <EmptyDescription>{t.spectatorDescription}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {terminal && (
            <Empty className="my-10 min-h-[28rem] border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Link2OffIcon />
                </EmptyMedia>
                <EmptyTitle>{terminalCopy[0]}</EmptyTitle>
                <EmptyDescription>{terminalCopy[1]}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {state.status === "error" && (
                  <Button type="button" variant="outline" onClick={retry}>
                    <RefreshCwIcon data-icon="inline-start" />
                    {t.spectatorRetry}
                  </Button>
                )}
                <Button type="button" variant="ghost" onClick={returnHome}>
                  {t.backToHome}
                </Button>
              </EmptyContent>
            </Empty>
          )}

          {state.share && !terminal && (
            <>
              {(state.status === "offline" ||
                state.status === "reconnecting") && (
                <Alert className="mt-6">
                  {state.status === "offline" ? <WifiOffIcon /> : <RadioIcon />}
                  <AlertTitle>
                    {state.status === "offline"
                      ? t.spectatorOffline
                      : t.spectatorReconnecting}
                  </AlertTitle>
                  <AlertDescription>
                    {state.status === "offline"
                      ? t.spectatorOfflineDescription
                      : t.spectatorReconnectingDescription}
                  </AlertDescription>
                </Alert>
              )}
              <GameRoom
                t={t}
                language={language}
                game={spectatorGameToGameState(state.share.snapshot.game)}
                view={state.share.snapshot.view}
                matchMode={state.share.snapshot.matchMode}
                webmcpStatus="unsupported"
                lastToolCall={null}
                danmakuEnabled={danmakuEnabled}
                onDanmakuToggle={setDanmakuEnabled}
                onMove={noop}
                onPass={noop}
                onResign={noop}
                onRequestScoring={noop}
                onWithdrawScoring={noop}
                onSendMessage={rejectMessage}
                onReturnLobby={returnHome}
                onNewGame={returnHome}
                audience="spectator"
                spectatorStatus={roomStatus(state.status)}
                spectatorViewerCount={state.share.viewerCount}
              />
            </>
          )}
        </main>
        <SiteFooter t={t} />
      </div>
    </LazyMotion>
  );
}
