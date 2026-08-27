import { z } from "zod";

import type { AreaScore } from "./go";
import { SHARE_ID_PATTERN, shareIdFromPath, sharePath } from "./share-route";
import {
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES,
  type GameState,
  type MatchMode,
  type RoomView,
} from "./session";

const SHARE_PROTOCOL_VERSION = 1 as const;
export const SHARE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const SHARE_HOST_OFFLINE_MS = 45_000;
export const MAX_SHARE_BODY_BYTES = 256 * 1024;
export const MAX_SPECTATORS_PER_SHARE = 50;
export const MAX_SPECTATORS_GLOBAL = 1000;
export { SHARE_ID_PATTERN, shareIdFromPath, sharePath };

type ShareableView = Extract<RoomView, "playing" | "finished">;

export type SpectatorGameState = Omit<
  GameState,
  "positionHistory" | "nextMessageId"
>;

export type ShareSnapshot = {
  protocolVersion: typeof SHARE_PROTOCOL_VERSION;
  view: ShareableView;
  matchMode: MatchMode;
  game: SpectatorGameState;
};

export type ShareHostStatus = "live" | "offline" | "ended";

export type PublicShareState = {
  shareId: string;
  version: number;
  snapshot: ShareSnapshot;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  hostStatus: ShareHostStatus;
  viewerCount: number;
};

export type ShareCreateResponse = PublicShareState & {
  hostToken: string;
  sharePath: string;
};

export type ShareMutationResponse = {
  ok: true;
  version: number;
  updatedAt: number;
  expiresAt: number;
  hostStatus: ShareHostStatus;
  viewerCount: number;
};

export type ShareProblem = {
  ok: false;
  error:
    | "invalid_origin"
    | "invalid_content_type"
    | "body_too_large"
    | "invalid_json"
    | "invalid_snapshot"
    | "invalid_share_id"
    | "share_not_found"
    | "share_revoked"
    | "share_expired"
    | "invalid_host_token"
    | "stale_version"
    | "share_capacity_reached"
    | "spectator_capacity_reached"
    | "rate_limited"
    | "method_not_allowed";
  message: string;
  currentVersion?: number;
};

export type ShareStreamEvent =
  | { type: "snapshot"; state: PublicShareState }
  | {
      type: "presence";
      viewerCount: number;
      hostStatus: ShareHostStatus;
      updatedAt: number;
    }
  | { type: "revoked" }
  | { type: "expired" };

const stoneSchema = z.enum(["black", "white"]);
const actorSchema = z.enum(["human", "ai"]);
const pointSchema = z.object({
  x: z.int().min(0).max(18),
  y: z.int().min(0).max(18),
});
const cellSchema = stoneSchema.nullable();
const boardSchema = z.array(z.array(cellSchema).min(1).max(19)).min(1).max(19);
const scoreSideSchema = z.object({
  stones: z.int().nonnegative(),
  territory: z.int().nonnegative(),
  total: z.number().nonnegative(),
});
const areaScoreSchema: z.ZodType<AreaScore> = z.object({
  method: z.literal("chinese-tromp-taylor-area"),
  komi: z.number().nonnegative(),
  black: scoreSideSchema,
  white: scoreSideSchema,
  neutral: z.int().nonnegative(),
  winner: z.union([stoneSchema, z.literal("tie")]),
  margin: z.number().nonnegative(),
});
const scoringSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("idle") }),
  z.object({
    status: z.literal("pending"),
    requestedBy: z.literal("human"),
    requestRevision: z.int().nonnegative(),
    preview: areaScoreSchema,
  }),
  z.object({
    status: z.literal("complete"),
    result: areaScoreSchema,
  }),
]);
const moveSchema = z.object({
  number: z.int().positive(),
  point: pointSchema.optional(),
  stone: stoneSchema,
  captured: z.int().nonnegative(),
  actor: actorSchema,
  pass: z.boolean().optional(),
});
const messageSchema = z.object({
  id: z.int().positive(),
  actor: actorSchema,
  text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  moveNumber: z.int().nonnegative(),
  createdAt: z.int().nonnegative(),
});
const spectatorGameSchema = z.object({
  boardSize: z.union([z.literal(9), z.literal(13), z.literal(19)]),
  board: boardSchema,
  turn: stoneSchema,
  humanColor: stoneSchema,
  aiColor: stoneSchema,
  aiModelId: z.string().trim().min(1).max(160).nullable(),
  captures: z.object({
    black: z.int().nonnegative(),
    white: z.int().nonnegative(),
  }),
  moves: z.array(moveSchema),
  passCount: z.int().min(0).max(2),
  revision: z.int().nonnegative(),
  endReason: z
    .enum(["human-resigned", "ai-resigned", "double-pass", "scored"])
    .optional(),
  scoring: scoringSchema,
  lastScoringDecision: z.literal("rejected").nullable(),
  messages: z.array(messageSchema).max(MAX_MESSAGES),
});

function validateBoard(
  game: SpectatorGameState,
  context: z.RefinementCtx,
): void {
  if (
    game.board.length !== game.boardSize ||
    game.board.some((row) => row.length !== game.boardSize)
  ) {
    context.addIssue({
      code: "custom",
      message: "Board dimensions mismatch",
    });
  }
  if (game.humanColor === game.aiColor) {
    context.addIssue({
      code: "custom",
      message: "Players must use opposite colors",
    });
  }
}

function validateMoves(
  game: SpectatorGameState,
  context: z.RefinementCtx,
): void {
  for (const [index, move] of game.moves.entries()) {
    if (move.number !== index + 1) {
      context.addIssue({
        code: "custom",
        message: "Move numbers must be sequential",
      });
    }
    const hasPoint = move.point !== undefined;
    if (move.pass === hasPoint) {
      context.addIssue({
        code: "custom",
        message: "Move point/pass mismatch",
      });
    }
    if (
      move.point &&
      (move.point.x >= game.boardSize || move.point.y >= game.boardSize)
    ) {
      context.addIssue({
        code: "custom",
        message: "Move lies outside the board",
      });
    }
  }
}

function validateMessages(
  game: SpectatorGameState,
  context: z.RefinementCtx,
): void {
  let previousMessageId = 0;
  for (const message of game.messages) {
    if (
      message.id <= previousMessageId ||
      message.moveNumber > game.moves.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid message sequence",
      });
    }
    previousMessageId = message.id;
  }
}

function validateShareSnapshot(
  snapshot: ShareSnapshot,
  context: z.RefinementCtx,
): void {
  validateBoard(snapshot.game, context);
  validateMoves(snapshot.game, context);
  validateMessages(snapshot.game, context);
  if ((snapshot.view === "finished") !== Boolean(snapshot.game.endReason)) {
    context.addIssue({
      code: "custom",
      message: "View and end state mismatch",
    });
  }
}

const shareSnapshotSchema: z.ZodType<ShareSnapshot> = z
  .object({
    protocolVersion: z.literal(SHARE_PROTOCOL_VERSION),
    view: z.enum(["playing", "finished"]),
    matchMode: z.enum(["real", "demo"]),
    game: spectatorGameSchema,
  })
  .superRefine(validateShareSnapshot);

const shareMetadataSchema = z.object({
  version: z.int().positive(),
  updatedAt: z.int().nonnegative(),
  expiresAt: z.int().nonnegative(),
  hostStatus: z.enum(["live", "offline", "ended"]),
  viewerCount: z.int().min(0).max(MAX_SPECTATORS_PER_SHARE),
});

const publicShareStateSchema: z.ZodType<PublicShareState> =
  shareMetadataSchema.extend({
    shareId: z.string().regex(SHARE_ID_PATTERN),
    snapshot: shareSnapshotSchema,
    createdAt: z.int().nonnegative(),
  });

export const shareCreateResponseSchema: z.ZodType<ShareCreateResponse> =
  publicShareStateSchema.and(
    z.object({
      hostToken: z.string().min(32).max(128),
      sharePath: z.string().regex(/^\/watch\/[A-Za-z0-9_-]{32}$/),
    }),
  );

export const shareMutationResponseSchema: z.ZodType<ShareMutationResponse> =
  shareMetadataSchema.extend({ ok: z.literal(true) });

export const shareProblemSchema: z.ZodType<ShareProblem> = z.object({
  ok: z.literal(false),
  error: z.enum([
    "invalid_origin",
    "invalid_content_type",
    "invalid_json",
    "body_too_large",
    "invalid_snapshot",
    "invalid_share_id",
    "share_not_found",
    "share_revoked",
    "share_expired",
    "invalid_host_token",
    "stale_version",
    "share_capacity_reached",
    "spectator_capacity_reached",
    "rate_limited",
    "method_not_allowed",
  ]),
  message: z.string().min(1).max(240),
  currentVersion: z.int().positive().optional(),
});

export const sharePresenceEventSchema = z.object({
  type: z.literal("presence"),
  viewerCount: z.int().min(0).max(MAX_SPECTATORS_PER_SHARE),
  hostStatus: z.enum(["live", "offline", "ended"]),
  updatedAt: z.number().nonnegative(),
});

function cloneAreaScore(score: AreaScore): AreaScore {
  return {
    ...score,
    black: { ...score.black },
    white: { ...score.white },
  };
}

function cloneScoring(
  game: Pick<GameState, "scoring">,
): SpectatorGameState["scoring"] {
  if (game.scoring.status === "pending") {
    return { ...game.scoring, preview: cloneAreaScore(game.scoring.preview) };
  }
  if (game.scoring.status === "complete") {
    return { ...game.scoring, result: cloneAreaScore(game.scoring.result) };
  }
  return { status: "idle" };
}

export function createShareSnapshot(
  game: GameState,
  view: RoomView,
  matchMode: MatchMode,
): ShareSnapshot | null {
  if (view !== "playing" && view !== "finished") return null;
  const snapshot: ShareSnapshot = {
    protocolVersion: SHARE_PROTOCOL_VERSION,
    view,
    matchMode,
    game: {
      boardSize: game.boardSize,
      board: game.board.map((row) => [...row]),
      turn: game.turn,
      humanColor: game.humanColor,
      aiColor: game.aiColor,
      aiModelId: game.aiModelId,
      captures: { ...game.captures },
      moves: game.moves.map((move) => ({
        ...move,
        point: move.point ? { ...move.point } : undefined,
      })),
      passCount: game.passCount,
      revision: game.revision,
      endReason: game.endReason,
      scoring: cloneScoring(game),
      lastScoringDecision: game.lastScoringDecision,
      messages: game.messages.map((message) => ({ ...message })),
    },
  };
  const parsed = shareSnapshotSchema.safeParse(snapshot);
  return parsed.success ? parsed.data : null;
}

export function spectatorGameToGameState(game: SpectatorGameState): GameState {
  return {
    ...game,
    board: game.board.map((row) => [...row]),
    captures: { ...game.captures },
    moves: game.moves.map((move) => ({
      ...move,
      point: move.point ? { ...move.point } : undefined,
    })),
    scoring: cloneScoring(game),
    messages: game.messages.map((message) => ({ ...message })),
    positionHistory: [],
    nextMessageId: (game.messages.at(-1)?.id ?? 0) + 1,
  };
}

export function parseShareSnapshot(input: unknown): ShareSnapshot | null {
  const result = shareSnapshotSchema.safeParse(input);
  return result.success ? result.data : null;
}

export function parsePublicShareState(input: unknown): PublicShareState | null {
  const result = publicShareStateSchema.safeParse(input);
  return result.success ? result.data : null;
}
