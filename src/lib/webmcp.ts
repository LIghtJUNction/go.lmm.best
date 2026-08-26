import type { Point } from "./go.js";

export type WebMCPStatus = "checking" | "available" | "bridge" | "unsupported";

export const GO_WEBMCP_BRIDGE_NAME = "goWebMCP";
export const WEBMCP_TOOL_NAMES = [
  "join_go_match",
  "get_go_game_state",
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
  playMove: (
    point: Point,
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

function parsePoint(input: unknown): Point | null {
  const values = asRecord(input);
  const x = values.x;
  const y = values.y;
  if (
    typeof x === "number" &&
    Number.isInteger(x) &&
    typeof y === "number" &&
    Number.isInteger(y)
  ) {
    return { x, y };
  }

  const coordinate = values.coordinate;
  if (typeof coordinate !== "string") return null;
  const match = coordinate
    .trim()
    .toUpperCase()
    .match(/^([A-HJ-T])\s*(1[0-9]|[1-9])$/);
  if (!match) return null;
  const letters = "ABCDEFGHJKLMNOPQRST";
  return { x: letters.indexOf(match[1]), y: Number(match[2]) - 1 };
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

function createTools(callbacks: WebMCPCallbacks): WebMCPTool[] {
  return [
    {
      name: "join_go_match",
      description:
        "Join the FIFO human-vs-AI Go queue with a real model ID. If no human is waiting, the AI remains queued until a human arrives.",
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
      description:
        "Read the queue/setup/game phase, board size, board, revision, turn, scoring request, messages, captures, and move log before acting.",
      inputSchema: toolSchema(),
      execute: () => callbacks.getGameState(),
      annotations: { readOnlyHint: true },
    },
    {
      name: "play_go_move",
      description:
        "Play a legal AI move. Read state first, then send its revision with x/y or a standard Go coordinate such as D4 or Q16.",
      inputSchema: toolSchema(
        {
          x: { type: "integer", minimum: 0, maximum: 18 },
          y: { type: "integer", minimum: 0, maximum: 18 },
          coordinate: {
            type: "string",
            pattern: "^[A-HJ-T](1[0-9]|[1-9])$",
            description: "Alternative coordinate; Go coordinates omit I.",
          },
          ...revisionSchema(),
        },
        ["expectedRevision"],
      ),
      execute: (input) => {
        const point = parsePoint(input);
        const revision = parseRevision(input);
        if (!point) return { ok: false, error: "invalid_coordinate" };
        return revision === null
          ? { ok: false, error: "invalid_revision" }
          : callbacks.playMove(point, revision);
      },
    },
    {
      name: "pass_go_turn",
      description:
        "Pass the AI turn using the latest revision. Two consecutive passes finish and score the game.",
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
      description: "Resign the current game using the latest revision.",
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
      description:
        "Accept or reject the human scoring request using its latest revision. Acceptance ends the game with Chinese-style area scoring and White +7.5 komi.",
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
      description:
        "Send one plain-text AI message to the human during the current game. Maximum 240 characters.",
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
