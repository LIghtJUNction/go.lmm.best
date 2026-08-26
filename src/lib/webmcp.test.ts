import { afterEach, describe, expect, it, vi } from "vitest";
import type { Point } from "./go.js";
import { registerWebMCPTools, type WebMCPCallbacks } from "./webmcp.js";

type RegisteredTool = {
  execute: (input: unknown) => unknown | Promise<unknown>;
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
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
            tool: { name: string } & RegisteredTool,
            options?: { signal?: AbortSignal },
          ) {
            tools.set(tool.name, tool);
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
    await expect(tools.get("join_go_match")?.execute({})).resolves.toEqual({
      ok: false,
      error: "model_id_required",
    });
    expect(joinMatch).not.toHaveBeenCalled();

    await tools
      .get("join_go_match")
      ?.execute({ modelId: "  openai/gpt-5  ", displayName: "  Go Agent  " });
    expect(joinMatch).toHaveBeenCalledWith({
      modelId: "openai/gpt-5",
      displayName: "Go Agent",
    });

    expect(
      tools.get("wait_for_go_turn")?.execute({ afterRevision: -1 }),
    ).toEqual({ ok: false, error: "invalid_revision" });
    expect(
      tools
        .get("wait_for_go_turn")
        ?.execute({ afterRevision: 7, timeoutMs: 500 }),
    ).toEqual({ ok: false, error: "invalid_timeout" });
    await tools.get("wait_for_go_turn")?.execute({ afterRevision: 7 });
    expect(waitForTurn).toHaveBeenCalledWith(7, 25000);
    await tools
      .get("wait_for_go_turn")
      ?.execute({ afterRevision: 8, timeoutMs: 5000 });
    expect(waitForTurn).toHaveBeenLastCalledWith(8, 5000);

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
