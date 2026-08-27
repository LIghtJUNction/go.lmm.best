import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Point } from "./go.js";
import { WEBMCP_OUTPUT_SCHEMAS } from "./webmcp-output-schemas.js";
import { registerWebMCPTools, type WebMCPCallbacks } from "./webmcp.js";

type RegisteredTool = {
  description: string;
  inputSchema: {
    properties: Record<string, unknown>;
    required?: string[];
  };
  outputSchema: Record<string, unknown>;
  execute: (input: unknown) => unknown | Promise<unknown>;
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "window");
});

describe("WebMCP tool registration", () => {
  it("requires and normalizes the AI model ID before joining", async () => {
    const tools = new Map<string, RegisteredTool>();
    const signals: AbortSignal[] = [];
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        modelContext: {
          async registerTool(
            tool: { name: string } & Omit<RegisteredTool, "outputSchema">,
            options?: { signal?: AbortSignal },
          ) {
            expect(tool).not.toHaveProperty("outputSchema");
            const outputSchema =
              WEBMCP_OUTPUT_SCHEMAS[
                tool.name as keyof typeof WEBMCP_OUTPUT_SCHEMAS
              ];
            expect(outputSchema).toBeDefined();
            tools.set(tool.name, { ...tool, outputSchema });
            if (options?.signal) signals.push(options.signal);
          },
        },
      },
    });

    const joinMatch = vi.fn(() => ({ ok: true }));
    const waitForTurn = vi.fn(() => ({ ok: true, waitStatus: "ready" }));
    const playMove = vi.fn(
      (_move: Point | string, _expectedRevision: number) => ({ ok: true }),
    );
    const callbacks: WebMCPCallbacks = {
      joinMatch,
      getGameState: () => ({ ok: true }),
      waitForTurn,
      playMove,
      passTurn: (_expectedRevision: number) => ({ ok: true }),
      resignGame: (_expectedRevision: number) => ({ ok: true }),
      respondScoring: (_decision, _expectedRevision) => ({ ok: true }),
      sendMessage: (_message) => ({ ok: true }),
    };
    const onStatus = vi.fn();
    const dispose = registerWebMCPTools(callbacks, onStatus);

    await vi.waitFor(() => expect(tools.size).toBe(8));
    for (const tool of tools.values()) {
      expect(tool.description).toContain("outputSchema");
      expect(tool.description).toContain("Success result:");
      expect(tool.description).toContain("Failure result:");
      expect(tool.outputSchema).toMatchObject({ oneOf: expect.any(Array) });
      expect(() =>
        z.fromJSONSchema(
          tool.outputSchema as Parameters<typeof z.fromJSONSchema>[0],
        ),
      ).not.toThrow();
    }

    const getStateParser = z.fromJSONSchema(
      tools.get("get_go_game_state")?.outputSchema as Parameters<
        typeof z.fromJSONSchema
      >[0],
    );
    const nonPlayingStates = [
      {
        ok: true,
        phase: "idle",
        revision: 0,
        latestHumanMessageId: 0,
        actionRequired: "join_go_match",
      },
      {
        ok: true,
        phase: "queue",
        revision: 0,
        latestHumanMessageId: 0,
        queueSide: "human",
        queuePosition: 1,
        modelId: null,
        actionRequired: "join_go_match",
      },
      {
        ok: true,
        phase: "queue",
        revision: 0,
        latestHumanMessageId: 0,
        queueSide: "ai",
        queuePosition: 1,
        modelId: "provider/model",
        actionRequired: "wait_for_go_turn",
      },
      {
        ok: true,
        phase: "setup",
        revision: 0,
        latestHumanMessageId: 0,
        modelId: "openai/gpt-5",
        boardOptions: [9, 13, 19],
        defaultBoardSize: 9,
        message: "The human must choose the board size.",
        actionRequired: "wait_for_go_turn",
      },
    ];
    for (const state of nonPlayingStates) {
      expect(getStateParser.parse(state)).toEqual(state);
    }
    expect(() =>
      getStateParser.parse({
        ...nonPlayingStates[1],
        modelId: "provider/model",
        actionRequired: "wait_for_go_turn",
      }),
    ).toThrow();

    const playingState = {
      ok: true,
      phase: "playing",
      revision: 13,
      latestHumanMessageId: 1,
      actionRequired: "wait_for_go_turn",
      boardSize: 9,
      board: {
        coordinateSystem:
          "Standard Go coordinates: columns A-T omit I; row 1 is the bottom edge.",
        legend: "X black, O white, . empty",
        diagram: "  A B C D E F G H J\n9 . . . . . . . . .",
        black: ["D4"],
        white: ["E6"],
        emptyCount: 79,
      },
      turn: "black",
      turnActor: "human",
      aiColor: "white",
      humanColor: "black",
      captures: { black: 0, white: 0 },
      moves: [
        {
          number: 1,
          point: { x: 3, y: 5 },
          stone: "black",
          captured: 0,
          actor: "human",
          coordinate: "D4",
        },
        {
          number: 2,
          point: { x: 4, y: 3 },
          stone: "white",
          captured: 0,
          actor: "ai",
          coordinate: "E6",
        },
      ],
      lastMove: "E6",
      scoring: { status: "idle" },
      messages: [
        {
          id: 1,
          actor: "human",
          text: "Your move.",
          moveNumber: 2,
          createdAt: 1_700_000_000_000,
        },
      ],
      endReason: null,
    };
    expect(getStateParser.parse(playingState)).toEqual(playingState);
    const score = {
      method: "chinese-tromp-taylor-area",
      komi: 7.5,
      black: { stones: 1, territory: 0, total: 1 },
      white: { stones: 1, territory: 0, total: 8.5 },
      neutral: 79,
      winner: "white",
      margin: 7.5,
    };
    expect(
      getStateParser.parse({
        ...playingState,
        actionRequired: "respond_go_scoring",
        scoring: {
          status: "pending",
          requestedBy: "human",
          requestRevision: 13,
          preview: score,
        },
      }),
    ).toMatchObject({ scoring: { status: "pending" } });
    expect(
      getStateParser.parse({
        ...playingState,
        phase: "finished",
        actionRequired: "game_finished",
        moves: [
          ...playingState.moves,
          {
            number: 3,
            stone: "black",
            captured: 0,
            actor: "human",
            pass: true,
            coordinate: "pass",
          },
        ],
        scoring: { status: "complete", result: score },
        endReason: "scored",
      }),
    ).toMatchObject({ phase: "finished", endReason: "scored" });
    expect(() =>
      getStateParser.parse({
        ...playingState,
        phase: "finished",
        actionRequired: "game_finished",
        endReason: null,
      }),
    ).toThrow();
    expect(() =>
      getStateParser.parse({
        ...playingState,
        actionRequired: "game_finished",
      }),
    ).toThrow();
    expect(
      getStateParser.parse({
        ...playingState,
        turn: "white",
        turnActor: "ai",
        actionRequired: "play_go_move, pass_go_turn, or resign_go_game",
      }),
    ).toMatchObject({ phase: "playing", turnActor: "ai" });
    expect(() =>
      getStateParser.parse({
        ...playingState,
        turnActor: "ai",
        actionRequired: "wait_for_go_turn",
      }),
    ).toThrow();
    expect(() =>
      getStateParser.parse({
        ...playingState,
        phase: "finished",
        actionRequired: "game_finished",
        endReason: "human-resigned",
        scoring: {
          status: "pending",
          requestedBy: "human",
          requestRevision: 13,
          preview: score,
        },
      }),
    ).toThrow();
    expect(() =>
      getStateParser.parse({
        ...playingState,
        actionRequired: "respond_go_scoring",
        scoring: {
          status: "pending",
          requestedBy: "human",
          requestRevision: 13,
          preview: { ...score, winner: "tie", margin: 0 },
        },
      }),
    ).toThrow();
    expect(() =>
      getStateParser.parse({
        ...playingState,
        board: { ...playingState.board, unexpected: true },
      }),
    ).toThrow();

    const waitParser = z.fromJSONSchema(
      tools.get("wait_for_go_turn")?.outputSchema as Parameters<
        typeof z.fromJSONSchema
      >[0],
    );
    expect(
      waitParser.parse({
        ...playingState,
        waitStatus: "waiting",
        waitReason: "timeout",
        afterRevision: 13,
        afterMessageId: 1,
      }),
    ).toMatchObject({ waitStatus: "waiting", waitReason: "timeout" });
    expect(() =>
      waitParser.parse({
        ...playingState,
        waitStatus: "ready",
        waitReason: "timeout",
        afterRevision: 13,
        afterMessageId: 1,
      }),
    ).toThrow();
    expect(() =>
      waitParser.parse({
        ...playingState,
        turn: "white",
        turnActor: "ai",
        waitStatus: "waiting",
        waitReason: "timeout",
        afterRevision: 13,
        afterMessageId: 1,
      }),
    ).toThrow();
    expect(
      waitParser.parse({
        ...playingState,
        turn: "white",
        turnActor: "ai",
        actionRequired: "play_go_move, pass_go_turn, or resign_go_game",
        waitStatus: "ready",
        waitReason: "human_message",
        afterRevision: 13,
        afterMessageId: 1,
      }),
    ).toMatchObject({ waitStatus: "ready", waitReason: "human_message" });

    const playTool = tools.get("play_go_move");
    const playOutputParser = z.fromJSONSchema(
      playTool?.outputSchema as Parameters<typeof z.fromJSONSchema>[0],
    );
    expect(
      playOutputParser.parse({
        ok: true,
        revision: 14,
        latestHumanMessageId: 1,
        phase: "playing",
      }),
    ).toMatchObject({ ok: true, revision: 14 });
    expect(
      playOutputParser.parse({
        ok: false,
        error: "occupied",
        currentRevision: 13,
      }),
    ).toMatchObject({ ok: false, error: "occupied" });
    expect(() =>
      playOutputParser.parse({ ok: false, error: "occupied" }),
    ).toThrow();
    expect(() =>
      playOutputParser.parse({
        ok: false,
        error: "invalid_coordinate",
        currentRevision: 13,
      }),
    ).toThrow();
    expect(() =>
      playOutputParser.parse({ ok: false, error: "unknown_error" }),
    ).toThrow();

    for (const [toolName, sessionError] of [
      ["pass_go_turn", "wrong_turn"],
      ["resign_go_game", "stale_state"],
      ["respond_go_scoring", "scoring_not_pending"],
    ] as const) {
      const parser = z.fromJSONSchema(
        tools.get(toolName)?.outputSchema as Parameters<
          typeof z.fromJSONSchema
        >[0],
      );
      expect(
        parser.parse({
          ok: false,
          error: sessionError,
          currentRevision: 13,
        }),
      ).toMatchObject({ error: sessionError, currentRevision: 13 });
      expect(() => parser.parse({ ok: false, error: sessionError })).toThrow();
      expect(parser.parse({ ok: false, error: "invalid_revision" })).toEqual({
        ok: false,
        error: "invalid_revision",
      });
      expect(() =>
        parser.parse({
          ok: false,
          error: "invalid_revision",
          currentRevision: 13,
        }),
      ).toThrow();
      expect(() =>
        parser.parse({ ok: false, error: "game_finished" }),
      ).toThrow();
    }

    expect(Object.keys(playTool?.inputSchema.properties ?? {})).toEqual([
      "coordinate",
      "expectedRevision",
    ]);
    expect(playTool?.inputSchema.required).toEqual([
      "coordinate",
      "expectedRevision",
    ]);
    expect(playTool?.execute({ x: 3, y: 4, expectedRevision: 9 })).toEqual({
      ok: false,
      error: "invalid_coordinate",
    });

    await expect(tools.get("join_go_match")?.execute({})).resolves.toEqual({
      ok: false,
      error: "model_id_required",
    });
    const longModelResult = await tools
      .get("join_go_match")
      ?.execute({ modelId: "m".repeat(121) });
    expect(longModelResult).toEqual({
      ok: false,
      error: "model_id_too_long",
    });
    const joinOutputParser = z.fromJSONSchema(
      tools.get("join_go_match")?.outputSchema as Parameters<
        typeof z.fromJSONSchema
      >[0],
    );
    expect(joinOutputParser.parse(longModelResult)).toEqual(longModelResult);
    expect(joinMatch).not.toHaveBeenCalled();

    await tools.get("join_go_match")?.execute({ modelId: "  openai/gpt-5  " });
    expect(joinMatch).toHaveBeenCalledWith({
      modelId: "openai/gpt-5",
    });

    expect(
      tools.get("wait_for_go_turn")?.execute({ afterRevision: -1 }),
    ).toEqual({ ok: false, error: "invalid_revision" });
    expect(
      tools
        .get("wait_for_go_turn")
        ?.execute({ afterRevision: 7, timeoutMs: 500 }),
    ).toEqual({ ok: false, error: "invalid_timeout" });
    expect(
      tools
        .get("wait_for_go_turn")
        ?.execute({ afterRevision: 7, afterMessageId: -1 }),
    ).toEqual({ ok: false, error: "invalid_message_id" });
    await tools.get("wait_for_go_turn")?.execute({ afterRevision: 7 });
    expect(waitForTurn).toHaveBeenCalledWith(7, null, 25000);
    await tools.get("wait_for_go_turn")?.execute({
      afterRevision: 8,
      afterMessageId: 11,
      timeoutMs: 5000,
    });
    expect(waitForTurn).toHaveBeenLastCalledWith(8, 11, 5000);

    await tools
      .get("play_go_move")
      ?.execute({ coordinate: " d 4 ", expectedRevision: 9 });
    expect(playMove).toHaveBeenCalledWith("D4", 9);
    expect(onStatus).toHaveBeenCalledWith("available");
    expect(onStatus.mock.calls.map(([status]) => status)).toEqual([
      "checking",
      "available",
    ]);

    dispose();
    expect(signals).toHaveLength(8);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("exposes complete descriptors through the compatibility bridge", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {},
    });
    const onStatus = vi.fn();
    const joinMatch = vi.fn(() => ({ ok: true }));
    const dispose = registerWebMCPTools(
      {
        joinMatch,
        getGameState: () => ({ ok: true }),
        waitForTurn: () => ({ ok: true }),
        playMove: () => ({ ok: true }),
        passTurn: () => ({ ok: true }),
        resignGame: () => ({ ok: true }),
        respondScoring: () => ({ ok: true }),
        sendMessage: () => ({ ok: true }),
      },
      onStatus,
    );

    const bridge = globalThis.window.goWebMCP;
    expect(bridge?.listTools()).toHaveLength(8);
    const descriptors = bridge?.describeTools() ?? [];
    expect(descriptors).toHaveLength(8);
    expect(
      descriptors.every((tool) =>
        Array.isArray((tool.outputSchema as { oneOf?: unknown }).oneOf),
      ),
    ).toBe(true);
    expect(descriptors).not.toHaveProperty("0.execute");
    await expect(
      bridge?.callTool("join_go_match", { modelId: "m".repeat(121) }),
    ).resolves.toEqual({ ok: false, error: "model_id_too_long" });
    expect(joinMatch).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith("bridge");

    dispose();
    expect(globalThis.window.goWebMCP).toBeUndefined();
  });

  it("reports an unsupported browser after one capability check", () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {},
    });
    const onStatus = vi.fn();

    registerWebMCPTools(
      {
        joinMatch: () => ({ ok: true }),
        getGameState: () => ({ ok: true }),
        waitForTurn: () => ({ ok: true }),
        playMove: () => ({ ok: true }),
        passTurn: () => ({ ok: true }),
        resignGame: () => ({ ok: true }),
        respondScoring: () => ({ ok: true }),
        sendMessage: () => ({ ok: true }),
      },
      onStatus,
    );

    expect(onStatus.mock.calls.map(([status]) => status)).toEqual([
      "checking",
      "unsupported",
    ]);
  });

  it("does not publish a late registration failure after disposal", async () => {
    let rejectRegistration: ((reason?: unknown) => void) | undefined;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        modelContext: {
          registerTool: vi.fn(
            () =>
              new Promise<void>((_resolve, reject) => {
                rejectRegistration = reject;
              }),
          ),
        },
      },
    });
    const onStatus = vi.fn();
    const dispose = registerWebMCPTools(
      {
        joinMatch: () => ({ ok: true }),
        getGameState: () => ({ ok: true }),
        waitForTurn: () => ({ ok: true }),
        playMove: () => ({ ok: true }),
        passTurn: () => ({ ok: true }),
        resignGame: () => ({ ok: true }),
        respondScoring: () => ({ ok: true }),
        sendMessage: () => ({ ok: true }),
      },
      onStatus,
    );

    await vi.waitFor(() => expect(rejectRegistration).toBeTypeOf("function"));
    dispose();
    rejectRegistration?.(new Error("late failure"));
    await Promise.resolve();

    expect(onStatus.mock.calls.map(([status]) => status)).toEqual(["checking"]);
  });

  it("does not report ready until every tool finishes registering", async () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        modelContext: {
          registerTool: vi.fn().mockRejectedValue(new Error("denied")),
        },
      },
    });
    const onStatus = vi.fn();

    registerWebMCPTools(
      {
        joinMatch: () => ({ ok: true }),
        getGameState: () => ({ ok: true }),
        waitForTurn: () => ({ ok: true }),
        playMove: () => ({ ok: true }),
        passTurn: () => ({ ok: true }),
        resignGame: () => ({ ok: true }),
        respondScoring: () => ({ ok: true }),
        sendMessage: () => ({ ok: true }),
      },
      onStatus,
    );

    await vi.waitFor(() =>
      expect(onStatus).toHaveBeenLastCalledWith("unsupported"),
    );
    expect(onStatus).not.toHaveBeenCalledWith("available");
  });
});
