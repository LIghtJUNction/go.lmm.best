import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { domAnimation, LazyMotion } from "motion/react";

import {
  ErrorNotice,
  GameRoom,
  Header,
  Lobby,
  Searching,
  SiteFooter,
} from "@/components/room-ui";
import { LivePopulationStrip } from "@/components/live-population";
import { MatchSetup } from "@/components/match-setup";
import { ShareControls } from "@/components/share-controls";
import { useGameShare } from "@/hooks/use-game-share";
import { useInterfacePreferences } from "@/hooks/use-interface-preferences";
import {
  formatGoBoardForAgent,
  formatGoCoordinate,
  parseGoCoordinate,
  type Point,
} from "@/lib/go";
import { copy, type Language } from "@/lib/i18n";
import { initialLanguage, initialTheme } from "@/lib/preferences";
import { createShareSnapshot } from "@/lib/share";
import {
  appendMessage,
  BOARD_SIZES,
  createGame,
  DEFAULT_BOARD_SIZE,
  getPopulation,
  passSessionTurn,
  playSessionMove,
  requestSessionScoring,
  resignSessionGame,
  respondToSessionScoring,
  withdrawSessionScoring,
  type GameState,
  type MatchMode,
  type QueueSide,
  type RoomView,
  type SessionError,
  type SessionResult,
  type Theme,
} from "@/lib/session";
import {
  registerWebMCPTools,
  type WebMCPCallbacks,
  type WebMCPStatus,
} from "@/lib/webmcp";

import "@/board.css";

type ErrorKey =
  | "wrongTurn"
  | "toolNeedsQueue"
  | "toolAlreadyMatched"
  | "toolNeedsGame"
  | "toolWrongTurn"
  | "toolStaleState"
  | "toolInvalidMove"
  | "illegalOccupied"
  | "illegalSuicide"
  | "illegalRepetition"
  | "scoringAlreadyRequested"
  | "scoringNotRequested"
  | "scoringPending"
  | "messageEmpty"
  | "messageTooLong"
  | "messageDuplicate";

function errorKeyFor(error: SessionError): ErrorKey {
  const errors: Record<SessionError, ErrorKey> = {
    occupied: "illegalOccupied",
    suicide: "illegalSuicide",
    repetition: "illegalRepetition",
    wrong_turn: "wrongTurn",
    stale_state: "toolStaleState",
    scoring_pending: "scoringPending",
    scoring_already_pending: "scoringAlreadyRequested",
    scoring_not_pending: "scoringNotRequested",
    game_finished: "toolNeedsGame",
    message_empty: "messageEmpty",
    message_too_long: "messageTooLong",
    message_duplicate: "messageDuplicate",
  };
  return errors[error];
}

function latestHumanMessageId(game: GameState) {
  for (let index = game.messages.length - 1; index >= 0; index -= 1) {
    if (game.messages[index].actor === "human") return game.messages[index].id;
  }
  return 0;
}

type WaitOutcome =
  | {
      waitStatus: "ready";
      waitReason: "human_message" | "ai_turn" | "scoring" | "game_finished";
    }
  | { waitStatus: "waiting"; waitReason: "timeout" }
  | { waitStatus: "stopped"; waitReason: "room_stopped" };

type WaitReadiness = Exclude<WaitOutcome, { waitStatus: "waiting" }> | null;

function App() {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [view, setView] = useState<RoomView>("idle");
  const [matchMode, setMatchMode] = useState<MatchMode>("real");
  const [queueSide, setQueueSide] = useState<QueueSide>(null);
  const [game, setGame] = useState<GameState>(createGame);
  const [webmcpStatus, setWebmcpStatus] = useState<WebMCPStatus>("checking");
  const [queueStartedAt, setQueueStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);
  const [lastToolCall, setLastToolCall] = useState<string | null>(null);
  const [waitingPreview, setWaitingPreview] = useState(false);
  const [danmakuEnabled, setDanmakuEnabled] = useState(
    () => localStorage.getItem("go-lmm-danmaku") === "on",
  );

  const t = useMemo(() => copy[language], [language]);
  const errorMessage = errorKey ? t[errorKey] : null;
  const shareSnapshot = useMemo(
    () => createShareSnapshot(game, view, matchMode),
    [game, matchMode, view],
  );
  const {
    state: shareState,
    create: createShare,
    retry: retryShare,
    stop: stopShare,
    detach: detachShare,
  } = useGameShare(shareSnapshot);
  const viewRef = useRef(view);
  const queueSideRef = useRef(queueSide);
  const gameRef = useRef(game);
  const stateChangeListenersRef = useRef(new Set<() => void>());
  const callbacksRef = useRef<WebMCPCallbacks>({
    joinMatch: () => ({ ok: false, error: "not_ready" }),
    getGameState: () => ({ ok: false, error: "not_ready" }),
    waitForTurn: () => ({ ok: false, error: "not_ready" }),
    playMove: () => ({ ok: false, error: "not_ready" }),
    passTurn: () => ({ ok: false, error: "not_ready" }),
    resignGame: () => ({ ok: false, error: "not_ready" }),
    respondScoring: () => ({ ok: false, error: "not_ready" }),
    sendMessage: () => ({ ok: false, error: "not_ready" }),
  });

  const notifyStateChange = useCallback(() => {
    for (const listener of stateChangeListenersRef.current) listener();
  }, []);
  const changeView = useCallback(
    (nextView: RoomView) => {
      viewRef.current = nextView;
      setView(nextView);
      notifyStateChange();
    },
    [notifyStateChange],
  );
  const changeQueueSide = useCallback(
    (nextSide: QueueSide) => {
      queueSideRef.current = nextSide;
      setQueueSide(nextSide);
      notifyStateChange();
    },
    [notifyStateChange],
  );
  const commitGame = useCallback(
    (nextGame: GameState) => {
      gameRef.current = nextGame;
      setGame(nextGame);
      if (nextGame.endReason) changeView("finished");
      notifyStateChange();
    },
    [changeView, notifyStateChange],
  );

  const applySessionResult = useCallback(
    (result: SessionResult) => {
      if (!result.ok) {
        setErrorKey(errorKeyFor(result.error));
        return false;
      }
      commitGame(result.game);
      setErrorKey(null);
      return true;
    },
    [commitGame],
  );

  useInterfacePreferences(language, theme);

  useEffect(() => {
    localStorage.setItem("go-lmm-danmaku", danmakuEnabled ? "on" : "off");
  }, [danmakuEnabled]);

  useEffect(() => {
    if (view !== "searching" || queueStartedAt === null) {
      setElapsed(0);
      return;
    }
    const update = () =>
      setElapsed(Math.floor((Date.now() - queueStartedAt) / 1000));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [queueStartedAt, view]);

  const resetRoom = useCallback(async () => {
    if (viewRef.current === "playing") {
      const stopped = await stopShare();
      if (!stopped) return;
    } else if (viewRef.current === "finished") {
      const detached = await detachShare();
      if (!detached) return;
    }
    const nextGame = createGame();
    commitGame(nextGame);
    changeQueueSide(null);
    changeView("idle");
    setQueueStartedAt(null);
    setMatchMode("real");
    setLastToolCall(null);
    setWaitingPreview(false);
    setErrorKey(null);
  }, [changeQueueSide, changeView, commitGame, detachShare, stopShare]);

  const matchHumanWithWaitingAi = useCallback(() => {
    changeQueueSide(null);
    changeView("setup");
    setQueueStartedAt(null);
    setWaitingPreview(false);
    setErrorKey(null);
  }, [changeQueueSide, changeView]);

  const startHumanQueue = useCallback(() => {
    if (viewRef.current === "searching" && queueSideRef.current === "ai") {
      matchHumanWithWaitingAi();
      return;
    }
    const nextGame = createGame();
    commitGame(nextGame);
    changeQueueSide("human");
    changeView("searching");
    setQueueStartedAt(Date.now());
    setMatchMode("real");
    setLastToolCall(null);
    setErrorKey(null);
  }, [changeQueueSide, changeView, commitGame, matchHumanWithWaitingAi]);

  const previewWhileWaiting = useCallback(() => {
    if (viewRef.current === "idle") startHumanQueue();
    setWaitingPreview(true);
  }, [startHumanQueue]);

  const startConfiguredGame = useCallback(
    (boardSize: BoardSize) => {
      commitGame(createGame(gameRef.current.aiModelId, boardSize));
      changeView("playing");
      setWaitingPreview(false);
      setErrorKey(null);
    },
    [changeView, commitGame],
  );

  const joinMatch = useCallback(
    (input: { modelId: string }) => {
      const currentView = viewRef.current;
      const currentQueueSide = queueSideRef.current;

      if (currentView === "idle") {
        commitGame(createGame(input.modelId));
        changeQueueSide("ai");
        changeView("searching");
        setQueueStartedAt(Date.now());
        setLastToolCall("join_go_match");
        return {
          ok: true,
          status: "queued",
          queueSide: "ai",
          queuePosition: 1,
          modelId: input.modelId,
          revision: 0,
          latestHumanMessageId: 0,
          actionRequired: "wait_for_go_turn",
        };
      }

      if (currentView === "searching" && currentQueueSide === "human") {
        commitGame(createGame(input.modelId));
        changeQueueSide(null);
        changeView("setup");
        setQueueStartedAt(null);
        setWaitingPreview(false);
        setLastToolCall("join_go_match");
        return {
          ok: true,
          status: "matched",
          phase: "setup",
          modelId: input.modelId,
          revision: 0,
          latestHumanMessageId: 0,
          defaultBoardSize: DEFAULT_BOARD_SIZE,
          boardOptions: BOARD_SIZES,
          actionRequired: "wait_for_go_turn",
        };
      }

      if (currentView === "searching" && currentQueueSide === "ai") {
        return gameRef.current.aiModelId === input.modelId
          ? {
              ok: true,
              status: "queued",
              queueSide: "ai",
              queuePosition: 1,
              revision: gameRef.current.revision,
              latestHumanMessageId: latestHumanMessageId(gameRef.current),
              actionRequired: "wait_for_go_turn",
            }
          : { ok: false, error: "ai_queue_occupied" };
      }

      return { ok: false, error: "already_matched" };
    },
    [changeQueueSide, changeView, commitGame],
  );

  const getGameState = useCallback(() => {
    const currentView = viewRef.current;
    const currentGame = gameRef.current;
    if (currentView === "idle") {
      return {
        ok: true,
        phase: "idle",
        revision: currentGame.revision,
        latestHumanMessageId: latestHumanMessageId(currentGame),
        actionRequired: "join_go_match",
      };
    }
    if (currentView === "searching") {
      return {
        ok: true,
        phase: "queue",
        revision: currentGame.revision,
        latestHumanMessageId: latestHumanMessageId(currentGame),
        queueSide: queueSideRef.current,
        queuePosition: 1,
        modelId: currentGame.aiModelId,
        actionRequired:
          queueSideRef.current === "human"
            ? "join_go_match"
            : "wait_for_go_turn",
      };
    }
    if (currentView === "setup") {
      return {
        ok: true,
        phase: "setup",
        revision: currentGame.revision,
        latestHumanMessageId: latestHumanMessageId(currentGame),
        modelId: currentGame.aiModelId,
        boardOptions: BOARD_SIZES,
        defaultBoardSize: DEFAULT_BOARD_SIZE,
        message: t.waitingForBoardSelection,
        actionRequired: "wait_for_go_turn",
      };
    }

    const lastMove = currentGame.moves.at(-1);
    const actionRequired = currentGame.endReason
      ? "game_finished"
      : currentGame.scoring.status === "pending"
        ? "respond_go_scoring"
        : currentGame.turn === currentGame.aiColor
          ? "play_go_move, pass_go_turn, or resign_go_game"
          : "wait_for_go_turn";
    return {
      ok: true,
      phase: currentView,
      revision: currentGame.revision,
      latestHumanMessageId: latestHumanMessageId(currentGame),
      boardSize: currentGame.boardSize,
      board: formatGoBoardForAgent(currentGame.board),
      turn: currentGame.turn,
      turnActor: currentGame.turn === currentGame.aiColor ? "ai" : "human",
      aiColor: currentGame.aiColor,
      humanColor: currentGame.humanColor,
      actionRequired,
      captures: currentGame.captures,
      moves: currentGame.moves.map((move) => ({
        ...move,
        coordinate: move.point
          ? formatGoCoordinate(move.point, currentGame.boardSize)
          : "pass",
      })),
      lastMove: lastMove
        ? lastMove.point
          ? formatGoCoordinate(lastMove.point, currentGame.boardSize)
          : "pass"
        : null,
      scoring: currentGame.scoring,
      messages: currentGame.messages,
      endReason: currentGame.endReason ?? null,
    };
  }, [t.waitingForBoardSelection]);

  const waitForTurn = useCallback(
    (
      afterRevision: number,
      afterMessageId: number | null,
      timeoutMs: number,
    ) => {
      if (afterRevision > gameRef.current.revision) {
        return Promise.resolve({
          ok: false,
          error: "future_revision",
          currentRevision: gameRef.current.revision,
        });
      }
      const currentMessageId = latestHumanMessageId(gameRef.current);
      const messageCursor = afterMessageId ?? currentMessageId;
      if (messageCursor > currentMessageId) {
        return Promise.resolve({
          ok: false,
          error: "future_message_id",
          currentMessageId,
        });
      }

      const readiness = (): WaitReadiness => {
        const currentView = viewRef.current;
        const currentGame = gameRef.current;
        if (currentView === "idle") {
          return { waitStatus: "stopped", waitReason: "room_stopped" };
        }
        if (currentView === "finished" || currentGame.endReason) {
          return { waitStatus: "ready", waitReason: "game_finished" };
        }
        if (
          currentView === "playing" &&
          currentGame.scoring.status === "pending"
        ) {
          return { waitStatus: "ready", waitReason: "scoring" };
        }
        if (
          currentView === "playing" &&
          latestHumanMessageId(currentGame) > messageCursor
        ) {
          return { waitStatus: "ready", waitReason: "human_message" };
        }
        if (
          currentView === "playing" &&
          currentGame.turn === currentGame.aiColor
        ) {
          return { waitStatus: "ready", waitReason: "ai_turn" };
        }
        return null;
      };

      const initialStatus = readiness();
      if (initialStatus) {
        return Promise.resolve({
          ...getGameState(),
          ...initialStatus,
          afterRevision,
          afterMessageId: messageCursor,
        });
      }

      return new Promise((resolve) => {
        let settled = false;
        let timer = 0;
        const finish = (status: WaitOutcome) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          stateChangeListenersRef.current.delete(onStateChange);
          resolve({
            ...getGameState(),
            ...status,
            afterRevision,
            afterMessageId: messageCursor,
          });
        };
        const onStateChange = () => {
          const status = readiness();
          if (status) finish(status);
        };
        stateChangeListenersRef.current.add(onStateChange);
        timer = window.setTimeout(
          () => finish({ waitStatus: "waiting", waitReason: "timeout" }),
          timeoutMs,
        );
        onStateChange();
      });
    },
    [getGameState],
  );

  const runAiTransition = useCallback(
    (toolName: string, transition: (game: GameState) => SessionResult) => {
      if (viewRef.current !== "playing") {
        return { ok: false, error: "game_not_playable" };
      }
      const result = transition(gameRef.current);
      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          currentRevision: result.currentRevision,
        };
      }
      commitGame(result.game);
      setLastToolCall(toolName);
      return {
        ok: true,
        revision: result.game.revision,
        latestHumanMessageId: latestHumanMessageId(result.game),
        phase: result.game.endReason ? "finished" : "playing",
      };
    },
    [commitGame],
  );

  const playAiMove = useCallback(
    (move: Point | string, expectedRevision: number) => {
      const point =
        typeof move === "string"
          ? parseGoCoordinate(move, gameRef.current.boardSize)
          : move;
      if (
        !point ||
        !Number.isInteger(point.x) ||
        !Number.isInteger(point.y) ||
        point.x < 0 ||
        point.y < 0 ||
        point.x >= gameRef.current.boardSize ||
        point.y >= gameRef.current.boardSize
      ) {
        return { ok: false, error: "invalid_coordinate" };
      }
      return runAiTransition("play_go_move", (current) =>
        playSessionMove(current, "ai", point, expectedRevision),
      );
    },
    [runAiTransition],
  );

  const passAiTurn = useCallback(
    (expectedRevision: number) =>
      runAiTransition("pass_go_turn", (current) =>
        passSessionTurn(current, "ai", expectedRevision),
      ),
    [runAiTransition],
  );

  const resignAiGame = useCallback(
    (expectedRevision: number) =>
      runAiTransition("resign_go_game", (current) =>
        resignSessionGame(current, "ai", expectedRevision),
      ),
    [runAiTransition],
  );

  const respondScoring = useCallback(
    (decision: "accept" | "reject", expectedRevision: number) =>
      runAiTransition("respond_go_scoring", (current) =>
        respondToSessionScoring(current, decision, expectedRevision),
      ),
    [runAiTransition],
  );

  const sendAiMessage = useCallback(
    (message: string) => {
      if (viewRef.current !== "playing") {
        return { ok: false, error: "game_not_playable" };
      }
      const result = appendMessage(gameRef.current, "ai", message);
      if (!result.ok) return { ok: false, error: result.error };
      commitGame(result.game);
      setLastToolCall("send_go_message");
      return {
        ok: true,
        messageId: result.message.id,
        latestHumanMessageId: latestHumanMessageId(result.game),
      };
    },
    [commitGame],
  );

  callbacksRef.current = {
    joinMatch,
    getGameState,
    waitForTurn,
    playMove: playAiMove,
    passTurn: passAiTurn,
    resignGame: resignAiGame,
    respondScoring,
    sendMessage: sendAiMessage,
  };

  useEffect(
    () =>
      registerWebMCPTools(
        {
          joinMatch: (input) => callbacksRef.current.joinMatch(input),
          getGameState: () => callbacksRef.current.getGameState(),
          waitForTurn: (revision, messageId, timeoutMs) =>
            callbacksRef.current.waitForTurn(revision, messageId, timeoutMs),
          playMove: (point, revision) =>
            callbacksRef.current.playMove(point, revision),
          passTurn: (revision) => callbacksRef.current.passTurn(revision),
          resignGame: (revision) => callbacksRef.current.resignGame(revision),
          respondScoring: (decision, revision) =>
            callbacksRef.current.respondScoring(decision, revision),
          sendMessage: (message) => callbacksRef.current.sendMessage(message),
        },
        setWebmcpStatus,
      ),
    [],
  );

  const playHumanMove = useCallback(
    (point: Point) => {
      if (viewRef.current !== "playing") return;
      if (
        applySessionResult(playSessionMove(gameRef.current, "human", point))
      ) {
        setLastToolCall(null);
      }
    },
    [applySessionResult],
  );

  const passHumanTurn = useCallback(() => {
    if (viewRef.current !== "playing") return;
    applySessionResult(passSessionTurn(gameRef.current, "human"));
  }, [applySessionResult]);

  const resignHumanGame = useCallback(() => {
    if (viewRef.current !== "playing") return;
    applySessionResult(resignSessionGame(gameRef.current, "human"));
  }, [applySessionResult]);

  const requestScoring = useCallback(() => {
    if (viewRef.current !== "playing") return;
    applySessionResult(requestSessionScoring(gameRef.current));
  }, [applySessionResult]);

  const withdrawScoring = useCallback(() => {
    applySessionResult(withdrawSessionScoring(gameRef.current));
  }, [applySessionResult]);

  const sendHumanMessage = useCallback(
    (message: string) => {
      const result = appendMessage(gameRef.current, "human", message);
      if (!result.ok) {
        setErrorKey(errorKeyFor(result.error));
        return false;
      }
      commitGame(result.game);
      setErrorKey(null);
      return true;
    },
    [commitGame],
  );

  const population = useMemo(
    () => getPopulation(view, queueSide),
    [queueSide, view],
  );
  const showPopulationStrip =
    view === "setup" || view === "playing" || view === "finished";
  const isGameView = view === "playing" || view === "finished";

  return (
    <LazyMotion features={domAnimation} strict>
      <div className="flex min-h-svh flex-col overflow-x-clip bg-background text-foreground">
        <Header
          t={t}
          language={language}
          theme={theme}
          webmcpStatus={webmcpStatus}
          onLanguageToggle={() =>
            setLanguage((current) => (current === "zh" ? "en" : "zh"))
          }
          onThemeToggle={() =>
            setTheme((current) => (current === "light" ? "dark" : "light"))
          }
          onReturnHome={resetRoom}
        />
        {showPopulationStrip && (
          <LivePopulationStrip t={t} stats={population} />
        )}
        <ErrorNotice
          t={t}
          message={errorMessage}
          onClose={() => setErrorKey(null)}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8">
          {view === "idle" && (
            <Lobby
              t={t}
              webmcpStatus={webmcpStatus}
              population={population}
              onStartMatch={startHumanQueue}
              onPreviewBoard={previewWhileWaiting}
            />
          )}
          {view === "searching" && (
            <Searching
              t={t}
              elapsed={elapsed}
              queueSide={queueSide ?? "human"}
              aiModelId={game.aiModelId}
              webmcpStatus={webmcpStatus}
              population={population}
              showBoardPreview={waitingPreview}
              onCancel={resetRoom}
              onPreviewBoard={previewWhileWaiting}
              onClosePreview={() => setWaitingPreview(false)}
              onJoinWaitingAi={matchHumanWithWaitingAi}
            />
          )}
          {view === "setup" && (
            <MatchSetup
              t={t}
              aiModelId={game.aiModelId ?? "WebMCP AI"}
              onStart={startConfiguredGame}
              onReturnHome={resetRoom}
            />
          )}
          {isGameView && (
            <GameRoom
              t={t}
              language={language}
              game={game}
              view={view}
              matchMode={matchMode}
              webmcpStatus={webmcpStatus}
              lastToolCall={lastToolCall}
              danmakuEnabled={danmakuEnabled}
              onDanmakuToggle={setDanmakuEnabled}
              onMove={playHumanMove}
              onPass={passHumanTurn}
              onResign={resignHumanGame}
              onRequestScoring={requestScoring}
              onWithdrawScoring={withdrawScoring}
              onSendMessage={sendHumanMessage}
              onNewGame={resetRoom}
              onReturnLobby={resetRoom}
              shareControls={
                <ShareControls
                  t={t}
                  state={shareState}
                  onCreate={createShare}
                  onRetry={retryShare}
                  onStop={stopShare}
                />
              }
            />
          )}
        </main>
        <SiteFooter t={t} />
      </div>
    </LazyMotion>
  );
}

export default App;
