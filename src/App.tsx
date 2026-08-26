import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, domAnimation, LazyMotion } from "motion/react";
import { ErrorNotice, GameRoom, Header, Lobby, Searching, SiteFooter } from "@/components/room-ui";
import type { Language } from "./lib/i18n";
import { copy } from "./lib/i18n";
import {
  applyMove,
  createBoard,
  serializeBoard,
  type Board,
  type Point,
  type Stone,
} from "./lib/go";
import {
  registerWebMCPTools,
  type WebMCPCallbacks,
  type WebMCPStatus,
} from "./lib/webmcp";

export type RoomView = "idle" | "searching" | "playing" | "finished";
export type MatchMode = "real" | "demo";
type EndReason = "human-resigned" | "ai-resigned" | "double-pass";
type Actor = "human" | "ai";
type ErrorKey =
  | "toolAlreadyMatched"
  | "toolNeedsQueue"
  | "toolNeedsGame"
  | "toolWrongTurn"
  | "toolStaleState"
  | "toolInvalidMove"
  | "wrongTurn"
  | "illegalOccupied"
  | "illegalSuicide"
  | "illegalRepetition";

export type PopulationStats = {
  humanPlayers: number;
  aiPlayers: number;
  activeGames: number;
  waitingHumans: number;
  waitingAi: number;
};

export type Move = {
  number: number;
  point?: Point;
  stone: Stone;
  captured: number;
  actor: Actor;
  pass?: boolean;
};

export type GameState = {
  board: Board;
  turn: Stone;
  humanColor: Stone;
  aiColor: Stone;
  aiModelId: string | null;
  captures: Record<Stone, number>;
  moves: Move[];
  positionHistory: string[];
  passCount: number;
  endReason?: EndReason;
};

const BOARD_SIZE = 9;
const HUMAN_COLOR: Stone = "black";
const AI_COLOR: Stone = "white";

function getPopulation(view: RoomView): PopulationStats {
  const humanPlayers = view === "searching" || view === "playing" ? 1 : 0;
  const aiPlayers = view === "playing" ? 1 : 0;
  const activeGames = Math.min(humanPlayers, aiPlayers);
  return {
    humanPlayers,
    aiPlayers,
    activeGames,
    waitingHumans: Math.max(humanPlayers - aiPlayers, 0),
    waitingAi: Math.max(aiPlayers - humanPlayers, 0),
  };
}

function createGame(aiModelId: string | null = null): GameState {
  const board = createBoard(BOARD_SIZE);
  return {
    board,
    turn: HUMAN_COLOR,
    humanColor: HUMAN_COLOR,
    aiColor: AI_COLOR,
    aiModelId,
    captures: { black: 0, white: 0 },
    moves: [],
    positionHistory: [serializeBoard(board)],
    passCount: 0,
  };
}

function App() {
  const [language, setLanguage] = useState<Language>("en");
  const [view, setView] = useState<RoomView>("idle");
  const [matchMode, setMatchMode] = useState<MatchMode>("real");
  const [game, setGame] = useState<GameState>(createGame);
  const [webmcpStatus, setWebmcpStatus] = useState<WebMCPStatus>("unsupported");
  const [queueStartedAt, setQueueStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [errorKey, setErrorMessage] = useState<ErrorKey | null>(null);
  const [lastToolCall, setLastToolCall] = useState<string | null>(null);
  const t = useMemo(() => copy[language], [language]);
  const errorMessage = errorKey ? t[errorKey] : null;
  const callbacksRef = useRef<WebMCPCallbacks>({
    joinMatch: () => ({ ok: false }),
    getGameState: () => ({ ok: false }),
    playMove: () => ({ ok: false }),
    passTurn: () => ({ ok: false }),
    resignGame: () => ({ ok: false }),
  });

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  useEffect(() => {
    if (view !== "searching" || queueStartedAt === null) {
      setElapsed(0);
      return;
    }

    const updateElapsed = () =>
      setElapsed(Math.floor((Date.now() - queueStartedAt) / 1000));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [queueStartedAt, view]);

  const startMatch = () => {
    setMatchMode("real");
    setView("searching");
    setQueueStartedAt(Date.now());
    setGame(createGame());
    setErrorMessage(null);
    setLastToolCall(null);
  };

  const startDemo = () => {
    setMatchMode("demo");
    setView("playing");
    setQueueStartedAt(null);
    setGame(createGame("demo/local"));
    setErrorMessage(null);
    setLastToolCall(null);
  };

  const returnToLobby = () => {
    setView("idle");
    setQueueStartedAt(null);
    setGame(createGame());
    setErrorMessage(null);
    setLastToolCall(null);
  };

  const getGameState = () => ({
    ok: true,
    room: view,
    mode: matchMode,
    boardSize: BOARD_SIZE,
    board: game.board.map((row) => row.map((cell) => cell ?? "empty")),
    turn: game.turn,
    humanColor: game.humanColor,
    aiColor: game.aiColor,
    aiModelId: game.aiModelId,
    captures: game.captures,
    moves: game.moves,
    revision: game.moves.length,
    positionHash: game.positionHistory.at(-1),
    lastMove: game.moves.at(-1) ?? null,
  });

  const joinMatch = (input: { modelId: string; displayName?: string }) => {
    if (view !== "searching") {
      const reason: ErrorKey =
        view === "playing" || view === "finished"
          ? "toolAlreadyMatched"
          : "toolNeedsQueue";
      setErrorMessage(reason);
      return { ok: false, error: t[reason] };
    }

    setView("playing");
    setQueueStartedAt(null);
    setGame(createGame(input.modelId));
    setErrorMessage(null);
    setLastToolCall("join_go_match");
    return {
      ok: true,
      matched: true,
      human: { displayName: t.human, color: HUMAN_COLOR },
      ai: {
        displayName: input.displayName || input.modelId,
        modelId: input.modelId,
        color: AI_COLOR,
      },
      message: t.statusReady,
    };
  };

  const playAiMove = (point: Point, expectedRevision: number) => {
    if (view !== "playing") {
      const message = t.toolNeedsGame;
      setErrorMessage("toolNeedsGame");
      return { ok: false, error: message };
    }
    if (expectedRevision !== game.moves.length) {
      const message = t.toolStaleState;
      setErrorMessage("toolStaleState");
      return { ok: false, error: message, currentRevision: game.moves.length };
    }
    if (game.turn !== game.aiColor) {
      const message = t.toolWrongTurn;
      setErrorMessage("toolWrongTurn");
      return { ok: false, error: message };
    }

    const result = applyMove(
      game.board,
      point,
      game.aiColor,
      new Set(game.positionHistory),
    );
    if (!result.ok) {
      const message = t.toolInvalidMove;
      setErrorMessage("toolInvalidMove");
      return { ok: false, error: message, reason: result.error };
    }

    const move: Move = {
      number: game.moves.length + 1,
      point,
      stone: game.aiColor,
      captured: result.captured,
      actor: "ai",
    };
    setGame((current) => ({
      ...current,
      board: result.board,
      turn: current.humanColor,
      captures: {
        ...current.captures,
        [current.aiColor]: current.captures[current.aiColor] + result.captured,
      },
      moves: [...current.moves, move],
      positionHistory: [
        ...current.positionHistory,
        serializeBoard(result.board),
      ],
      passCount: 0,
    }));
    setErrorMessage(null);
    setLastToolCall("play_go_move");
    return { ok: true, move, revision: move.number, nextTurn: game.humanColor };
  };

  const passFor = (actor: Actor, expectedRevision?: number) => {
    if (view !== "playing") {
      const message = t.toolNeedsGame;
      setErrorMessage("toolNeedsGame");
      return { ok: false, error: message };
    }
    if (actor === "ai" && expectedRevision !== game.moves.length) {
      const message = t.toolStaleState;
      setErrorMessage("toolStaleState");
      return { ok: false, error: message, currentRevision: game.moves.length };
    }
    const expectedStone = actor === "human" ? game.humanColor : game.aiColor;
    if (game.turn !== expectedStone) {
      const reason: ErrorKey =
        actor === "human" ? "wrongTurn" : "toolWrongTurn";
      setErrorMessage(reason);
      return { ok: false, error: t[reason] };
    }

    const move: Move = {
      number: game.moves.length + 1,
      stone: expectedStone,
      captured: 0,
      actor,
      pass: true,
    };
    const isFinished = game.passCount + 1 >= 2;
    setGame((current) => ({
      ...current,
      turn: current.turn === "black" ? "white" : "black",
      moves: [...current.moves, move],
      passCount: current.passCount + 1,
      endReason: isFinished ? "double-pass" : undefined,
    }));
    if (isFinished) setView("finished");
    setErrorMessage(null);
    setLastToolCall(actor === "ai" ? "pass_go_turn" : null);
    return {
      ok: true,
      finished: isFinished,
      revision: move.number,
      nextTurn: expectedStone === "black" ? "white" : "black",
    };
  };

  const resignFor = (actor: Actor, expectedRevision?: number) => {
    if (view !== "playing") {
      const message = t.toolNeedsGame;
      setErrorMessage("toolNeedsGame");
      return { ok: false, error: message };
    }
    if (actor === "ai" && expectedRevision !== game.moves.length) {
      const message = t.toolStaleState;
      setErrorMessage("toolStaleState");
      return { ok: false, error: message, currentRevision: game.moves.length };
    }
    const expectedStone = actor === "human" ? game.humanColor : game.aiColor;
    if (game.turn !== expectedStone && actor === "ai") {
      const message = t.toolWrongTurn;
      setErrorMessage("toolWrongTurn");
      return { ok: false, error: message };
    }

    const endReason: EndReason =
      actor === "human" ? "human-resigned" : "ai-resigned";
    setGame((current) => ({ ...current, endReason }));
    setView("finished");
    setErrorMessage(null);
    setLastToolCall(actor === "ai" ? "resign_go_game" : null);
    return {
      ok: true,
      finished: true,
      revision: game.moves.length,
      winner: actor === "human" ? game.aiColor : game.humanColor,
    };
  };

  const handleHumanMove = useCallback(
    (point: Point) => {
      if (view !== "playing") return;
      if (game.turn !== game.humanColor) {
        setErrorMessage("wrongTurn");
        return;
      }

      const result = applyMove(
        game.board,
        point,
        game.humanColor,
        new Set(game.positionHistory),
      );
      if (!result.ok) {
        const reason: ErrorKey =
          result.error === "occupied"
            ? "illegalOccupied"
            : result.error === "suicide"
              ? "illegalSuicide"
              : "illegalRepetition";
        setErrorMessage(reason);
        return;
      }

      const move: Move = {
        number: game.moves.length + 1,
        point,
        stone: game.humanColor,
        captured: result.captured,
        actor: "human",
      };
      setGame((current) => ({
        ...current,
        board: result.board,
        turn: current.aiColor,
        captures: {
          ...current.captures,
          [current.humanColor]:
            current.captures[current.humanColor] + result.captured,
        },
        moves: [...current.moves, move],
        positionHistory: [
          ...current.positionHistory,
          serializeBoard(result.board),
        ],
        passCount: 0,
      }));
      setErrorMessage(null);
      setLastToolCall(null);
    },
    [game, t, view],
  );

  callbacksRef.current = {
    joinMatch,
    getGameState,
    playMove: playAiMove,
    passTurn: (expectedRevision) => passFor("ai", expectedRevision),
    resignGame: (expectedRevision) => resignFor("ai", expectedRevision),
  };

  useEffect(
    () =>
      registerWebMCPTools(
        {
          joinMatch: (input) => callbacksRef.current.joinMatch(input),
          getGameState: () => callbacksRef.current.getGameState(),
          playMove: (point, expectedRevision) =>
            callbacksRef.current.playMove(point, expectedRevision),
          passTurn: (expectedRevision) =>
            callbacksRef.current.passTurn(expectedRevision),
          resignGame: (expectedRevision) =>
            callbacksRef.current.resignGame(expectedRevision),
        },
        setWebmcpStatus,
      ),
    [],
  );

  const toggleLanguage = () =>
    setLanguage((current) => (current === "zh" ? "en" : "zh"));
  const isGameView = view === "playing" || view === "finished";
  const population = useMemo(() => getPopulation(view), [view]);

  return (
    <LazyMotion features={domAnimation} strict>
    <div className="min-h-svh bg-background text-foreground">
      <Header
        t={t}
        language={language}
        webmcpStatus={webmcpStatus}
        onLanguageToggle={toggleLanguage}
        onReturnHome={returnToLobby}
      />

      <main className="mx-auto min-h-[calc(100svh-4rem)] w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <AnimatePresence initial={false} mode="wait">
        {view === "idle" && (
          <Lobby
            key="idle"
            t={t}
            webmcpStatus={webmcpStatus}
            population={population}
            onStartMatch={startMatch}
            onStartDemo={startDemo}
          />
        )}

        {view === "searching" && (
          <Searching
            key="searching"
            t={t}
            elapsed={elapsed}
            webmcpStatus={webmcpStatus}
            population={population}
            onCancel={returnToLobby}
            onStartDemo={startDemo}
          />
        )}

        {isGameView && (
          <GameRoom
            key={view}
            t={t}
            language={language}
            game={game}
            view={view}
            matchMode={matchMode}
            webmcpStatus={webmcpStatus}
            lastToolCall={lastToolCall}
            onMove={handleHumanMove}
            onPass={() => passFor("human")}
            onResign={() => resignFor("human")}
            onReturnLobby={returnToLobby}
            onNewGame={startMatch}
          />
        )}
        </AnimatePresence>
      </main>

      {errorMessage && <ErrorNotice t={t} message={errorMessage} onClose={() => setErrorMessage(null)} />}
      <SiteFooter t={t} />
    </div>
    </LazyMotion>
  );
}

export default App;
