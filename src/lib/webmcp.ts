import type { Point } from "./go.js";

export type WebMCPStatus = "checking" | "available" | "bridge" | "unsupported";

export const GO_WEBMCP_BRIDGE_NAME = "goWebMCP";
export const WEBMCP_TOOL_NAMES = [
  "join_go_match",
  "get_go_game_state",
  "wait_for_go_turn",
  "play_go_move",
  "pass_go_turn",
  "resign_go_game",
  "respond_go_scoring",
  "send_go_message",
] as const;

export type GoWebMCPBridge = {
  readonly version: 1;
  readonly source: "go.lmm.best";
  listTools: () => string[];
  callTool: (name: string, input?: unknown) => Promise<unknown>;
};

declare global {
  interface Window {
    goWebMCP?: GoWebMCPBridge;
  }
}

type ToolHandler = (input: unknown) => unknown | Promise<unknown>;

type WebMCPTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: ToolHandler;
  annotations?: {
    readOnlyHint?: boolean;
  };
};

type WebMCPModelContext = {
  registerTool?: (
    tool: WebMCPTool,
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

type DocumentWithModelContext = Document & {
  modelContext?: WebMCPModelContext;
};

type NavigatorWithModelContext = Navigator & {
  modelContext?: WebMCPModelContext;
};

export type WebMCPCallbacks = {
  joinMatch: (input: {
    modelId: string;
    displayName?: string;
  }) => unknown | Promise<unknown>;
  getGameState: () => unknown | Promise<unknown>;
  waitForTurn: (
    afterRevision: number,
    afterMessageId: number | null,
    timeoutMs: number,
  ) => unknown | Promise<unknown>;
  playMove: (
    move: Point | string,
    expectedRevision: number,
  ) => unknown | Promise<unknown>;
  passTurn: (expectedRevision: number) => unknown | Promise<unknown>;
  resignGame: (expectedRevision: number) => unknown | Promise<unknown>;
  respondScoring: (
    decision: "accept" | "reject",
    expectedRevision: number,
  ) => unknown | Promise<unknown>;
  sendMessage: (message: string) => unknown | Promise<unknown>;
};

function getModelContext(): WebMCPModelContext | undefined {
  if (typeof document !== "undefined") {
    const currentApi = (document as DocumentWithModelContext).modelContext;
    if (currentApi) return currentApi;
  }

  if (typeof navigator !== "undefined") {
    return (navigator as NavigatorWithModelContext).modelContext;
  }
  return undefined;
}

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null
    ? (input as Record<string, unknown>)
    : {};
}

function parseCoordinate(input: unknown): string | null {
  const coordinate = asRecord(input).coordinate;
  if (typeof coordinate !== "string") return null;
  const match = coordinate
    .trim()
    .toUpperCase()
    .match(/^([A-HJ-T])\s*(1[0-9]|[1-9])$/);
  if (!match) return null;
  return `${match[1]}${match[2]}`;
}

function parseRevision(input: unknown): number | null {
  const revision = asRecord(input).expectedRevision;
  return typeof revision === "number" &&
    Number.isInteger(revision) &&
    revision >= 0
    ? revision
    : null;
}

function toolSchema(
  properties: Record<string, unknown> = {},
  required: string[] = [],
) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function revisionSchema() {
  return {
    expectedRevision: {
      type: "integer",
      minimum: 0,
      description: "Revision returned by get_go_game_state.",
    },
  };
}

function toolDescription(summary: string, successShape: string): string {
  return `${summary} Success result: ${successShape}. Failure result: { ok: false, error: string, ... }.`;
}

function createTools(callbacks: WebMCPCallbacks): WebMCPTool[] {
  return [
    {
      name: "join_go_match",
      description: toolDescription(
        "Join the FIFO human-vs-AI Go queue with a real model ID. If no human is waiting, the AI remains queued until a human arrives.",
        '{ ok: true, status: "queued" | "matched", revision: integer, latestHumanMessageId: integer, actionRequired: string, ... }',
      ),
      inputSchema: toolSchema(
        {
          modelId: {
            type: "string",
            minLength: 1,
            maxLength: 120,
            description:
              "Required real model identifier, for example openai/gpt-5.6-sol.",
          },
          displayName: {
            type: "string",
            maxLength: 80,
            description: "Optional agent display name.",
          },
        },
        ["modelId"],
      ),
      execute: async (input) => {
        const values = asRecord(input);
        const modelId =
          typeof values.modelId === "string" ? values.modelId.trim() : "";
        if (!modelId) return { ok: false, error: "model_id_required" };
        return callbacks.joinMatch({
          modelId,
          displayName:
            typeof values.displayName === "string"
              ? values.displayName.trim() || undefined
              : undefined,
        });
      },
    },
    {
      name: "get_go_game_state",
      description: toolDescription(
        "Read the phase, revision, action required, compact ASCII board with standard Go coordinates, turn, scoring, messages, captures, and move log.",
        "{ ok: true, phase: string, revision: integer, latestHumanMessageId: integer, actionRequired: string, ... }",
      ),
      inputSchema: toolSchema(),
      execute: () => callbacks.getGameState(),
      annotations: { readOnlyHint: true },
    },
    {
      name: "wait_for_go_turn",
      description: toolDescription(
        "Wait without polling while queued, during setup, or on the human turn. Returns for a new human message, AI action, scoring, game end, room stop, or timeout.",
        '{ ok: true, waitStatus: "ready" | "waiting" | "stopped", waitReason: string, phase: string, revision: integer, ... }',
      ),
      inputSchema: toolSchema(
        {
          afterRevision: {
            type: "integer",
            minimum: 0,
            description:
              "Latest revision returned by join_go_match, get_go_game_state, an AI action, or the previous wait result.",
          },
          afterMessageId: {
            type: "integer",
            minimum: 0,
            description:
              "Latest human message ID already observed. Pass latestHumanMessageId to catch newer human chat without changing the game revision; if omitted, waiting starts from the current message.",
          },
          timeoutMs: {
            type: "integer",
            minimum: 1000,
            maximum: 120000,
            default: 25000,
            description:
              "Maximum wait before returning a harmless still-waiting result.",
          },
        },
        ["afterRevision"],
      ),
      execute: (input) => {
        const values = asRecord(input);
        const afterRevision = values.afterRevision;
        const afterMessageId = values.afterMessageId ?? null;
        const timeoutMs = values.timeoutMs ?? 25000;
        if (
          typeof afterRevision !== "number" ||
          !Number.isInteger(afterRevision) ||
          afterRevision < 0
        ) {
          return { ok: false, error: "invalid_revision" };
        }
        if (
          afterMessageId !== null &&
          (typeof afterMessageId !== "number" ||
            !Number.isInteger(afterMessageId) ||
            afterMessageId < 0)
        ) {
          return { ok: false, error: "invalid_message_id" };
        }
        if (
          typeof timeoutMs !== "number" ||
          !Number.isInteger(timeoutMs) ||
          timeoutMs < 1000 ||
          timeoutMs > 120000
        ) {
          return { ok: false, error: "invalid_timeout" };
        }
        return callbacks.waitForTurn(
          afterRevision,
          afterMessageId as number | null,
          timeoutMs,
        );
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "play_go_move",
      description: toolDescription(
        "Play a legal AI move using exactly one standard Go coordinate such as D4 or Q16; columns omit I. Do not send x/y fields.",
        '{ ok: true, revision: integer, latestHumanMessageId: integer, phase: "playing" | "finished" }',
      ),
      inputSchema: toolSchema(
        {
          coordinate: {
            type: "string",
            pattern: "^[A-HJ-T](1[0-9]|[1-9])$",
            description:
              "Required standard Go coordinate. Use a letter A-H or J-T plus row 1-19; x/y fields are not accepted.",
          },
          ...revisionSchema(),
        },
        ["coordinate", "expectedRevision"],
      ),
      execute: (input) => {
        const point = parseCoordinate(input);
        const revision = parseRevision(input);
        if (!point) return { ok: false, error: "invalid_coordinate" };
        return revision === null
          ? { ok: false, error: "invalid_revision" }
          : callbacks.playMove(point, revision);
      },
    },
    {
      name: "pass_go_turn",
      description: toolDescription(
        "Pass the AI turn using the latest revision. Two consecutive passes finish and score the game.",
        '{ ok: true, revision: integer, latestHumanMessageId: integer, phase: "playing" | "finished" }',
      ),
      inputSchema: toolSchema(revisionSchema(), ["expectedRevision"]),
      execute: (input) => {
        const revision = parseRevision(input);
        return revision === null
          ? { ok: false, error: "invalid_revision" }
          : callbacks.passTurn(revision);
      },
    },
    {
      name: "resign_go_game",
      description: toolDescription(
        "Resign the current game using the latest revision.",
        '{ ok: true, revision: integer, latestHumanMessageId: integer, phase: "finished" }',
      ),
      inputSchema: toolSchema(revisionSchema(), ["expectedRevision"]),
      execute: (input) => {
        const revision = parseRevision(input);
        return revision === null
          ? { ok: false, error: "invalid_revision" }
          : callbacks.resignGame(revision);
      },
    },
    {
      name: "respond_go_scoring",
      description: toolDescription(
        "Accept or reject the human scoring request using its latest revision. Acceptance ends the game with Chinese-style area scoring and White +7.5 komi.",
        '{ ok: true, revision: integer, latestHumanMessageId: integer, phase: "playing" | "finished" }',
      ),
      inputSchema: toolSchema(
        {
          decision: { type: "string", enum: ["accept", "reject"] },
          ...revisionSchema(),
        },
        ["decision", "expectedRevision"],
      ),
      execute: (input) => {
        const values = asRecord(input);
        const revision = parseRevision(input);
        const decision = values.decision;
        if (decision !== "accept" && decision !== "reject") {
          return { ok: false, error: "invalid_scoring_decision" };
        }
        return revision === null
          ? { ok: false, error: "invalid_revision" }
          : callbacks.respondScoring(decision, revision);
      },
    },
    {
      name: "send_go_message",
      description: toolDescription(
        "Send one plain-text AI message to the human during the current game. Maximum 240 characters.",
        "{ ok: true, messageId: integer, latestHumanMessageId: integer }",
      ),
      inputSchema: toolSchema(
        {
          message: { type: "string", minLength: 1, maxLength: 240 },
        },
        ["message"],
      ),
      execute: (input) => {
        const message = asRecord(input).message;
        return typeof message === "string"
          ? callbacks.sendMessage(message)
          : { ok: false, error: "message_required" };
      },
    },
  ];
}

function installCompatibilityBridge(tools: WebMCPTool[]): () => void {
  if (typeof window === "undefined") return () => undefined;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const bridge: GoWebMCPBridge = Object.freeze({
    version: 1,
    source: "go.lmm.best",
    listTools: () => [...byName.keys()],
    callTool: async (name, input = {}) => {
      const tool = byName.get(name);
      return tool
        ? tool.execute(input)
        : {
            ok: false,
            error: "unknown_tool",
            availableTools: [...byName.keys()],
          };
    },
  });
  Object.defineProperty(window, GO_WEBMCP_BRIDGE_NAME, {
    configurable: true,
    enumerable: false,
    value: bridge,
  });

  return () => {
    if (window.goWebMCP === bridge) delete window.goWebMCP;
  };
}

export function registerWebMCPTools(
  callbacks: WebMCPCallbacks,
  onStatus: (status: WebMCPStatus) => void,
): () => void {
  onStatus("checking");
  const tools = createTools(callbacks);
  const cleanupBridge = installCompatibilityBridge(tools);
  const modelContext = getModelContext();
  const registerTool = modelContext?.registerTool?.bind(modelContext);
  if (!registerTool) {
    onStatus(typeof window === "undefined" ? "unsupported" : "bridge");
    return cleanupBridge;
  }

  const controller = new AbortController();
  void (async () => {
    try {
      for (const tool of tools) {
        await registerTool(tool, { signal: controller.signal });
      }
      if (!controller.signal.aborted) onStatus("available");
    } catch {
      controller.abort();
      onStatus(typeof window === "undefined" ? "unsupported" : "bridge");
    }
  })();

  return () => {
    controller.abort();
    cleanupBridge();
  };
}
