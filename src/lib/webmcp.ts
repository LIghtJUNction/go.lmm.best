import type { Point } from "./go.js";
import {
  type JsonSchema,
  WEBMCP_OUTPUT_SCHEMAS,
} from "@/lib/webmcp-output-schemas";

export type WebMCPStatus = "checking" | "available" | "bridge" | "unsupported";

const GO_WEBMCP_BRIDGE_NAME = "goWebMCP";
const MAX_WEBMCP_MODEL_ID_LENGTH = 120;

type JsonObject = { [key: string]: JsonValue | undefined };
type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

type WebMCPToolDescriptor = Omit<WebMCPTool, "execute">;

type GoWebMCPBridge = {
  readonly version: 1;
  readonly source: "go.lmm.best";
  listTools: () => string[];
  describeTools: () => WebMCPToolDescriptor[];
  callTool: (name: string, input?: JsonValue) => Promise<unknown>;
};

declare global {
  interface Window {
    goWebMCP?: GoWebMCPBridge;
  }
}

type ToolHandler = (input?: JsonValue) => unknown | Promise<unknown>;

type WebMCPTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  execute: ToolHandler;
  annotations?: {
    readOnlyHint?: boolean;
  };
};

type NativeWebMCPTool = Omit<WebMCPTool, "outputSchema">;

type WebMCPModelContext = {
  registerTool?: (
    tool: NativeWebMCPTool,
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
  joinMatch: (input: { modelId: string }) => unknown | Promise<unknown>;
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

type RuntimeGlobals = {
  document?: DocumentWithModelContext;
  navigator?: NavigatorWithModelContext;
  window?: Window;
};

const runtimeGlobals = globalThis as RuntimeGlobals;

function getModelContext(): WebMCPModelContext | undefined {
  const currentApi = runtimeGlobals.document?.modelContext;
  if (currentApi) return currentApi;
  return runtimeGlobals.navigator?.modelContext;
}

function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isNonNegativeInteger(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function asRecord(input: JsonValue | undefined): JsonObject {
  return input !== null &&
    input !== undefined &&
    !Array.isArray(input) &&
    Object(input) === input
    ? (input as JsonObject)
    : {};
}

function parseCoordinate(input: JsonValue | undefined): string | null {
  const coordinate = asRecord(input).coordinate;
  if (!isString(coordinate)) return null;
  const match = coordinate
    .trim()
    .toUpperCase()
    .match(/^([A-HJ-T])\s*(1[0-9]|[1-9])$/);
  if (!match) return null;
  return `${match[1]}${match[2]}`;
}

function parseRevision(input: JsonValue | undefined): number | null {
  const revision = asRecord(input).expectedRevision;
  return isNonNegativeInteger(revision) ? revision : null;
}

function toolSchema(
  properties: Record<string, JsonSchema> = {},
  required: string[] = [],
): JsonSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function revisionSchema(): Record<string, JsonSchema> {
  return {
    expectedRevision: {
      type: "integer",
      minimum: 0,
      description: "Revision returned by get_go_game_state.",
    },
  };
}

function toolDescription(summary: string, successContract: string): string {
  return `${summary} Success result: ${successContract}. Failure result: { ok: false, error: string, ... }. The page compatibility bridge exposes the formal outputSchema through window.goWebMCP.describeTools().`;
}

function createJoinMatchTool(callbacks: WebMCPCallbacks): WebMCPTool {
  return {
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
          maxLength: MAX_WEBMCP_MODEL_ID_LENGTH,
          description:
            "Required real model identifier, for example openai/gpt-5.6-sol.",
        },
      },
      ["modelId"],
    ),
    outputSchema: WEBMCP_OUTPUT_SCHEMAS.join_go_match,
    execute: async (input) => {
      const values = asRecord(input);
      const modelId = isString(values.modelId) ? values.modelId.trim() : "";
      if (!modelId) return { ok: false, error: "model_id_required" };
      if (modelId.length > MAX_WEBMCP_MODEL_ID_LENGTH) {
        return { ok: false, error: "model_id_too_long" };
      }
      return callbacks.joinMatch({ modelId });
    },
  };
}

function createGetGameStateTool(callbacks: WebMCPCallbacks): WebMCPTool {
  return {
    name: "get_go_game_state",
    description: toolDescription(
      "Read the phase, revision, action required, compact ASCII board with standard Go coordinates, turn, scoring, messages, captures, and move log.",
      "a phase-discriminated object; playing/finished adds boardSize, board { coordinateSystem, legend, diagram, black, white, emptyCount }, colors, captures, moves, scoring, messages, endReason, and revision",
    ),
    inputSchema: toolSchema(),
    outputSchema: WEBMCP_OUTPUT_SCHEMAS.get_go_game_state,
    execute: () => callbacks.getGameState(),
    annotations: { readOnlyHint: true },
  };
}

function createWaitForTurnTool(callbacks: WebMCPCallbacks): WebMCPTool {
  return {
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
    outputSchema: WEBMCP_OUTPUT_SCHEMAS.wait_for_go_turn,
    execute: (input) => {
      const values = asRecord(input);
      const afterRevision = values.afterRevision;
      const afterMessageId = values.afterMessageId ?? null;
      const timeoutMs = values.timeoutMs ?? 25000;
      if (!isNonNegativeInteger(afterRevision)) {
        return { ok: false, error: "invalid_revision" };
      }
      if (afterMessageId !== null && !isNonNegativeInteger(afterMessageId)) {
        return { ok: false, error: "invalid_message_id" };
      }
      if (
        !isNonNegativeInteger(timeoutMs) ||
        timeoutMs < 1000 ||
        timeoutMs > 120000
      ) {
        return { ok: false, error: "invalid_timeout" };
      }
      return callbacks.waitForTurn(afterRevision, afterMessageId, timeoutMs);
    },
    annotations: { readOnlyHint: true },
  };
}

function createPlayMoveTool(callbacks: WebMCPCallbacks): WebMCPTool {
  return {
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
    outputSchema: WEBMCP_OUTPUT_SCHEMAS.play_go_move,
    execute: (input) => {
      const point = parseCoordinate(input);
      const revision = parseRevision(input);
      if (!point) return { ok: false, error: "invalid_coordinate" };
      return revision === null
        ? { ok: false, error: "invalid_revision" }
        : callbacks.playMove(point, revision);
    },
  };
}

function createPassTurnTool(callbacks: WebMCPCallbacks): WebMCPTool {
  return {
    name: "pass_go_turn",
    description: toolDescription(
      "Pass the AI turn using the latest revision. Two consecutive passes finish and score the game.",
      '{ ok: true, revision: integer, latestHumanMessageId: integer, phase: "playing" | "finished" }',
    ),
    inputSchema: toolSchema(revisionSchema(), ["expectedRevision"]),
    outputSchema: WEBMCP_OUTPUT_SCHEMAS.pass_go_turn,
    execute: (input) => {
      const revision = parseRevision(input);
      return revision === null
        ? { ok: false, error: "invalid_revision" }
        : callbacks.passTurn(revision);
    },
  };
}

function createResignGameTool(callbacks: WebMCPCallbacks): WebMCPTool {
  return {
    name: "resign_go_game",
    description: toolDescription(
      "Resign the current game using the latest revision.",
      '{ ok: true, revision: integer, latestHumanMessageId: integer, phase: "finished" }',
    ),
    inputSchema: toolSchema(revisionSchema(), ["expectedRevision"]),
    outputSchema: WEBMCP_OUTPUT_SCHEMAS.resign_go_game,
    execute: (input) => {
      const revision = parseRevision(input);
      return revision === null
        ? { ok: false, error: "invalid_revision" }
        : callbacks.resignGame(revision);
    },
  };
}

function createRespondScoringTool(callbacks: WebMCPCallbacks): WebMCPTool {
  return {
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
    outputSchema: WEBMCP_OUTPUT_SCHEMAS.respond_go_scoring,
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
  };
}

function createSendMessageTool(callbacks: WebMCPCallbacks): WebMCPTool {
  return {
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
    outputSchema: WEBMCP_OUTPUT_SCHEMAS.send_go_message,
    execute: (input) => {
      const message = asRecord(input).message;
      return isString(message)
        ? callbacks.sendMessage(message)
        : { ok: false, error: "message_required" };
    },
  };
}

function createTools(callbacks: WebMCPCallbacks): WebMCPTool[] {
  return [
    createJoinMatchTool(callbacks),
    createGetGameStateTool(callbacks),
    createWaitForTurnTool(callbacks),
    createPlayMoveTool(callbacks),
    createPassTurnTool(callbacks),
    createResignGameTool(callbacks),
    createRespondScoringTool(callbacks),
    createSendMessageTool(callbacks),
  ];
}

function installCompatibilityBridge(tools: WebMCPTool[]): () => void {
  const browserWindow = runtimeGlobals.window;
  if (!browserWindow) return () => undefined;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const descriptors = tools.map(({ execute: _execute, ...descriptor }) =>
    Object.freeze(descriptor),
  );
  const bridge: GoWebMCPBridge = Object.freeze({
    version: 1,
    source: "go.lmm.best",
    listTools: () => [...byName.keys()],
    describeTools: () => structuredClone(descriptors),
    callTool: async (name, input = {}) => {
      const tool = byName.get(name);
      return tool
        ? await tool.execute(input)
        : {
            ok: false,
            error: "unknown_tool",
            availableTools: [...byName.keys()],
          };
    },
  });
  Object.defineProperty(browserWindow, GO_WEBMCP_BRIDGE_NAME, {
    configurable: true,
    enumerable: false,
    value: bridge,
  });

  return () => {
    if (browserWindow.goWebMCP === bridge) {
      Reflect.deleteProperty(browserWindow, GO_WEBMCP_BRIDGE_NAME);
    }
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
    onStatus(runtimeGlobals.window ? "bridge" : "unsupported");
    return cleanupBridge;
  }

  const controller = new AbortController();
  void (async () => {
    try {
      for (const tool of tools) {
        const nativeTool: NativeWebMCPTool = {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: tool.execute,
          annotations: tool.annotations,
        };
        await registerTool(nativeTool, { signal: controller.signal });
      }
      if (!controller.signal.aborted) onStatus("available");
    } catch {
      const disposed = controller.signal.aborted;
      controller.abort();
      if (!disposed) {
        onStatus(runtimeGlobals.window ? "bridge" : "unsupported");
      }
    }
  })();

  return () => {
    controller.abort();
    cleanupBridge();
  };
}
