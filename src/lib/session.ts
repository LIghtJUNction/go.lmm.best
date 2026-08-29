import {
  applyMove,
  calculateAreaScore,
  createBoard,
  otherStone,
  serializeBoard,
  type AreaScore,
  type Board,
  type MoveError,
  type Point,
  type Stone,
} from "./go";

export const BOARD_SIZES = [9, 13, 19] as const;
export const DEFAULT_BOARD_SIZE = 9;
export const MAX_MESSAGE_LENGTH = 240;
export const MAX_MESSAGES = 100;

export type BoardSize = (typeof BOARD_SIZES)[number];

export function isBoardSize(value: number): value is BoardSize {
  return (BOARD_SIZES as readonly number[]).includes(value);
}
export type RoomView = "idle" | "searching" | "setup" | "playing" | "finished";
export type MatchMode = "real" | "demo";
export type Theme = "light" | "dark";
export type QueueSide = "human" | "ai" | null;
type EndReason =
  | "human-resigned"
  | "ai-resigned"
  | "double-pass"
  | "scored";
export type Actor = "human" | "ai";

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

export type GameMessage = {
  id: number;
  actor: Actor;
  text: string;
  moveNumber: number;
  createdAt: number;
};

type ScoringState =
  | { status: "idle" }
  | {
      status: "pending";
      requestedBy: "human";
      requestRevision: number;
      preview: AreaScore;
    }
  | { status: "complete"; result: AreaScore };

export type GameState = {
  boardSize: BoardSize;
  board: Board;
  turn: Stone;
  humanColor: Stone;
  aiColor: Stone;
  aiModelId: string | null;
  captures: Record<Stone, number>;
  moves: Move[];
  positionHistory: string[];
  passCount: number;
  revision: number;
  endReason?: EndReason;
  scoring: ScoringState;
  lastScoringDecision: "rejected" | null;
  messages: GameMessage[];
  nextMessageId: number;
};

export type SessionError =
  | MoveError
  | "wrong_turn"
  | "stale_state"
  | "scoring_pending"
  | "scoring_already_pending"
  | "scoring_not_pending"
  | "game_finished"
  | "message_empty"
  | "message_too_long"
  | "message_duplicate";

export type SessionResult =
  | { ok: true; game: GameState }
  | { ok: false; error: SessionError; currentRevision: number };

export type MessageResult =
  | { ok: true; game: GameState; message: GameMessage }
  | { ok: false; error: SessionError };

export function getPopulation(
  view: RoomView,
  queueSide: QueueSide,
): PopulationStats {
  const isMatched =
    view === "setup" || view === "playing" || view === "finished";
  const humanPlayers = isMatched || queueSide === "human" ? 1 : 0;
  const aiPlayers = isMatched || queueSide === "ai" ? 1 : 0;
  const activeGames = isMatched ? 1 : 0;

  return {
    humanPlayers,
    aiPlayers,
    activeGames,
    waitingHumans: Math.max(humanPlayers - aiPlayers, 0),
    waitingAi: Math.max(aiPlayers - humanPlayers, 0),
  };
}

export function createGame(
  aiModelId: string | null = null,
  boardSize: BoardSize = DEFAULT_BOARD_SIZE,
): GameState {
  const board = createBoard(boardSize);
  return {
    boardSize,
    board,
    turn: "black",
    humanColor: "black",
    aiColor: "white",
    aiModelId,
    captures: { black: 0, white: 0 },
    moves: [],
    positionHistory: [serializeBoard(board)],
    passCount: 0,
    revision: 0,
    scoring: { status: "idle" },
    lastScoringDecision: null,
    messages: [],
    nextMessageId: 1,
  };
}

function actorStone(game: GameState, actor: Actor): Stone {
  return actor === "human" ? game.humanColor : game.aiColor;
}

function validateAction(
  game: GameState,
  actor: Actor,
  expectedRevision?: number,
  allowPendingScoring = false,
): SessionError | null {
  if (game.endReason) return "game_finished";
  if (expectedRevision !== undefined && expectedRevision !== game.revision) {
    return "stale_state";
  }
  if (!allowPendingScoring && game.scoring.status === "pending") {
    return "scoring_pending";
  }
  if (game.turn !== actorStone(game, actor)) return "wrong_turn";
  return null;
}

export function playSessionMove(
  game: GameState,
  actor: Actor,
  point: Point,
  expectedRevision?: number,
): SessionResult {
  const validationError = validateAction(game, actor, expectedRevision);
  if (validationError) {
    return {
      ok: false,
      error: validationError,
      currentRevision: game.revision,
    };
  }

  const stone = actorStone(game, actor);
  const result = applyMove(
    game.board,
    point,
    stone,
    new Set(game.positionHistory.slice(0, -1)),
  );
  if (!result.ok) {
    return { ok: false, error: result.error, currentRevision: game.revision };
  }

  const move: Move = {
    number: game.moves.length + 1,
    point,
    stone,
    captured: result.captured,
    actor,
  };
  return {
    ok: true,
    game: {
      ...game,
      board: result.board,
      turn: otherStone(stone),
      captures: {
        ...game.captures,
        [stone]: game.captures[stone] + result.captured,
      },
      moves: [...game.moves, move],
      positionHistory: [...game.positionHistory, serializeBoard(result.board)],
      passCount: 0,
      revision: game.revision + 1,
      lastScoringDecision: null,
    },
  };
}

export function passSessionTurn(
  game: GameState,
  actor: Actor,
  expectedRevision?: number,
): SessionResult {
  const validationError = validateAction(game, actor, expectedRevision);
  if (validationError) {
    return {
      ok: false,
      error: validationError,
      currentRevision: game.revision,
    };
  }

  const stone = actorStone(game, actor);
  const passCount = game.passCount + 1;
  const move: Move = {
    number: game.moves.length + 1,
    stone,
    captured: 0,
    actor,
    pass: true,
  };
  const score = passCount >= 2 ? calculateAreaScore(game.board) : null;

  return {
    ok: true,
    game: {
      ...game,
      turn: otherStone(stone),
      moves: [...game.moves, move],
      passCount,
      revision: game.revision + 1,
      endReason: score ? "double-pass" : undefined,
      scoring: score ? { status: "complete", result: score } : game.scoring,
      lastScoringDecision: null,
    },
  };
}

export function resignSessionGame(
  game: GameState,
  actor: Actor,
  expectedRevision?: number,
): SessionResult {
  if (game.endReason) {
    return {
      ok: false,
      error: "game_finished",
      currentRevision: game.revision,
    };
  }
  if (expectedRevision !== undefined && expectedRevision !== game.revision) {
    return { ok: false, error: "stale_state", currentRevision: game.revision };
  }

  return {
    ok: true,
    game: {
      ...game,
      revision: game.revision + 1,
      endReason: actor === "human" ? "human-resigned" : "ai-resigned",
      scoring: { status: "idle" },
    },
  };
}

export function requestSessionScoring(game: GameState): SessionResult {
  if (game.endReason) {
    return {
      ok: false,
      error: "game_finished",
      currentRevision: game.revision,
    };
  }
  if (game.scoring.status === "pending") {
    return {
      ok: false,
      error: "scoring_already_pending",
      currentRevision: game.revision,
    };
  }

  const revision = game.revision + 1;
  return {
    ok: true,
    game: {
      ...game,
      revision,
      passCount: 0,
      scoring: {
        status: "pending",
        requestedBy: "human",
        requestRevision: revision,
        preview: calculateAreaScore(game.board),
      },
      lastScoringDecision: null,
    },
  };
}

export function respondToSessionScoring(
  game: GameState,
  decision: "accept" | "reject",
  expectedRevision: number,
): SessionResult {
  if (game.endReason) {
    return {
      ok: false,
      error: "game_finished",
      currentRevision: game.revision,
    };
  }
  if (expectedRevision !== game.revision) {
    return { ok: false, error: "stale_state", currentRevision: game.revision };
  }
  if (game.scoring.status !== "pending") {
    return {
      ok: false,
      error: "scoring_not_pending",
      currentRevision: game.revision,
    };
  }

  const revision = game.revision + 1;
  if (decision === "accept") {
    const result = calculateAreaScore(game.board);
    return {
      ok: true,
      game: {
        ...game,
        revision,
        endReason: "scored",
        scoring: { status: "complete", result },
        lastScoringDecision: null,
      },
    };
  }

  return {
    ok: true,
    game: {
      ...game,
      revision,
      passCount: 0,
      scoring: { status: "idle" },
      lastScoringDecision: "rejected",
    },
  };
}

export function withdrawSessionScoring(game: GameState): SessionResult {
  if (game.scoring.status !== "pending") {
    return {
      ok: false,
      error: "scoring_not_pending",
      currentRevision: game.revision,
    };
  }

  return {
    ok: true,
    game: {
      ...game,
      revision: game.revision + 1,
      passCount: 0,
      scoring: { status: "idle" },
      lastScoringDecision: null,
    },
  };
}

export function appendMessage(
  game: GameState,
  actor: Actor,
  text: string,
  now = Date.now(),
): MessageResult {
  if (game.endReason) return { ok: false, error: "game_finished" };
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return { ok: false, error: "message_empty" };
  if (normalized.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: "message_too_long" };
  }

  const lastMessage = game.messages.at(-1);
  if (
    lastMessage?.actor === actor &&
    lastMessage.text === normalized &&
    now - lastMessage.createdAt < 1500
  ) {
    return { ok: false, error: "message_duplicate" };
  }

  const message: GameMessage = {
    id: game.nextMessageId,
    actor,
    text: normalized,
    moveNumber: game.moves.length,
    createdAt: now,
  };
  const messages = [...game.messages, message].slice(-MAX_MESSAGES);
  return {
    ok: true,
    message,
    game: {
      ...game,
      messages,
      nextMessageId: game.nextMessageId + 1,
    },
  };
}
