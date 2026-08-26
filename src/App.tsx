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
import type { Point } from "@/lib/go";
import { copy, type Language } from "@/lib/i18n";
import {
  appendMessage,
  createGame,
  getPopulation,
  passSessionTurn,
  playSessionMove,
  requestSessionScoring,
  resignSessionGame,
  respondToSessionScoring,
  withdrawSessionScoring,
  type BoardSize,
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

function initialTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function App() {
  const [language, setLanguage] = useState<Language>("en");
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
  const [danmakuEnabled, setDanmakuEnabled] = useState(
    () => localStorage.getItem("go-lmm-danmaku") === "on",
  );

  const t = useMemo(() => copy[language], [language]);
  const errorMessage = errorKey ? t[errorKey] : null;
  const viewRef = useRef(view);
  const queueSideRef = useRef(queueSide);
  const gameRef = useRef(game);
  const callbacksRef = useRef<WebMCPCallbacks>({
    joinMatch: () => ({ ok: false, error: "not_ready" }),
    getGameState: () => ({ ok: false, error: "not_ready" }),
    playMove: () => ({ ok: false, error: "not_ready" }),
    passTurn: () => ({ ok: false, error: "not_ready" }),
    resignGame: () => ({ ok: false, error: "not_ready" }),
    respondScoring: () => ({ ok: false, error: "not_ready" }),
    sendMessage: () => ({ ok: false, error: "not_ready" }),
  });

  const changeView = useCallback((nextView: RoomView) => {
    viewRef.current = nextView;
    setView(nextView);
  }, []);
  const changeQueueSide = useCallback((nextSide: QueueSide) => {
    queueSideRef.current = nextSide;
    setQueueSide(nextSide);
  }, []);
  const commitGame = useCallback(
    (nextGame: GameState) => {
      gameRef.current = nextGame;
      setGame(nextGame);
      if (nextGame.endReason) changeView("finished");
    },
    [changeView],
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

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    localStorage.setItem("go-lmm-theme", theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#171a17" : "#f4f1e8");
  }, [theme]);

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

  const resetRoom = useCallback(() => {
    const nextGame = createGame();
    commitGame(nextGame);
    changeQueueSide(null);
    changeView("idle");
    setQueueStartedAt(null);
    setMatchMode("real");
    setLastToolCall(null);
    setErrorKey(null);
  }, [changeQueueSide, changeView, commitGame]);

  const matchHumanWithWaitingAi = useCallback(() => {
    changeQueueSide(null);
    changeView("setup");
    setQueueStartedAt(null);
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

  const startDemo = useCallback(() => {
    commitGame(createGame("demo/local"));
    changeQueueSide(null);
    changeView("playing");
    setQueueStartedAt(null);
    setMatchMode("demo");
    setLastToolCall(null);
    setErrorKey(null);
  }, [changeQueueSide, changeView, commitGame]);

  const startConfiguredGame = useCallback(
    (boardSize: BoardSize) => {
      commitGame(createGame(gameRef.current.aiModelId, boardSize));
      changeView("playing");
      setErrorKey(null);
    },
    [changeView, commitGame],
  );

  const joinMatch = useCallback(
    (input: { modelId: string; displayName?: string }) => {
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
        };
      }

      if (currentView === "searching" && currentQueueSide === "human") {
        commitGame(createGame(input.modelId));
        changeQueueSide(null);
        changeView("setup");
        setQueueStartedAt(null);
        setLastToolCall("join_go_match");
        return {
          ok: true,
          status: "matched",
          phase: "setup",
          modelId: input.modelId,
          defaultBoardSize: 9,
          boardOptions: [9, 13, 19],
        };
      }

      if (currentView === "searching" && currentQueueSide === "ai") {
        return gameRef.current.aiModelId === input.modelId
          ? { ok: true, status: "queued", queueSide: "ai", queuePosition: 1 }
          : { ok: false, error: "ai_queue_occupied" };
      }

      return { ok: false, error: "already_matched" };
    },
    [changeQueueSide, changeView, commitGame],
  );

  const getGameState = useCallback(() => {
    const currentView = viewRef.current;
    const currentGame = gameRef.current;
    if (currentView === "idle") return { ok: true, phase: "idle" };
    if (currentView === "searching") {
      return {
        ok: true,
        phase: "queue",
        queueSide: queueSideRef.current,
        queuePosition: 1,
        modelId: currentGame.aiModelId,
      };
    }
    if (currentView === "setup") {
      return {
        ok: true,
        phase: "setup",
        modelId: currentGame.aiModelId,
        boardOptions: [9, 13, 19],
        defaultBoardSize: 9,
        message: t.waitingForBoardSelection,
      };
    }

    return {
      ok: true,
      phase: currentView,
      revision: currentGame.revision,
      boardSize: currentGame.boardSize,
      board: currentGame.board.map((row) => row.map((cell) => cell ?? "empty")),
      turn: currentGame.turn,
      aiColor: currentGame.aiColor,
      humanColor: currentGame.humanColor,
      captures: currentGame.captures,
      moves: currentGame.moves,
      scoring: currentGame.scoring,
      messages: currentGame.messages,
      endReason: currentGame.endReason ?? null,
    };
  }, [t.waitingForBoardSelection]);

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
        phase: result.game.endReason ? "finished" : "playing",
      };
    },
    [commitGame],
  );

  const playAiMove = useCallback(
    (point: Point, expectedRevision: number) =>
      runAiTransition("play_go_move", (current) =>
        playSessionMove(current, "ai", point, expectedRevision),
      ),
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
      return { ok: true, messageId: result.message.id };
    },
    [commitGame],
  );

  callbacksRef.current = {
    joinMatch,
    getGameState,
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
        <main
          className={
            isGameView
              ? "mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8"
              : "mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8"
          }
        >
          {view === "idle" && (
            <Lobby
              t={t}
              webmcpStatus={webmcpStatus}
              population={population}
              onStartMatch={startHumanQueue}
              onStartDemo={startDemo}
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
              onCancel={resetRoom}
              onStartDemo={startDemo}
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
            />
          )}
        </main>
        <SiteFooter t={t} />
        <ErrorNotice
          t={t}
          message={errorMessage}
          onClose={() => setErrorKey(null)}
        />
      </div>
    </LazyMotion>
  );
}

export default App;
