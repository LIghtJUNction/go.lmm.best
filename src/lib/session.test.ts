import { describe, expect, it } from "vitest";

import {
  appendMessage,
  createGame,
  passSessionTurn,
  playSessionMove,
  requestSessionScoring,
  respondToSessionScoring,
  withdrawSessionScoring,
} from "./session";

describe("game session transitions", () => {
  it("increments a monotonic revision for board and scoring actions", () => {
    const firstMove = playSessionMove(createGame(), "human", { x: 4, y: 4 }, 0);
    expect(firstMove.ok).toBe(true);
    if (!firstMove.ok) return;
    expect(firstMove.game.revision).toBe(1);

    const request = requestSessionScoring(firstMove.game);
    expect(request.ok).toBe(true);
    if (!request.ok) return;
    expect(request.game.revision).toBe(2);
    expect(request.game.scoring.status).toBe("pending");

    expect(respondToSessionScoring(request.game, "accept", 1)).toMatchObject({
      ok: false,
      error: "stale_state",
      currentRevision: 2,
    });
  });

  it("freezes play while scoring is pending and resumes after rejection", () => {
    const request = requestSessionScoring(createGame());
    if (!request.ok) throw new Error("request should succeed");

    expect(
      playSessionMove(request.game, "human", { x: 4, y: 4 }, 1),
    ).toMatchObject({ ok: false, error: "scoring_pending" });

    const rejected = respondToSessionScoring(request.game, "reject", 1);
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.game.scoring).toEqual({ status: "idle" });
    expect(rejected.game.lastScoringDecision).toBe("rejected");
    expect(rejected.game.turn).toBe("black");
  });

  it("finishes with an area score after acceptance", () => {
    const request = requestSessionScoring(createGame());
    if (!request.ok) throw new Error("request should succeed");
    const accepted = respondToSessionScoring(request.game, "accept", 1);

    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.game.endReason).toBe("scored");
    expect(accepted.game.scoring.status).toBe("complete");
    if (accepted.game.scoring.status === "complete") {
      expect(accepted.game.scoring.result.komi).toBe(7.5);
    }
  });

  it("lets the human withdraw a pending request", () => {
    const request = requestSessionScoring(createGame());
    if (!request.ok) throw new Error("request should succeed");
    const withdrawn = withdrawSessionScoring(request.game);

    expect(withdrawn).toMatchObject({
      ok: true,
      game: { revision: 2, scoring: { status: "idle" } },
    });
    if (!withdrawn.ok) return;
    expect(respondToSessionScoring(withdrawn.game, "accept", 2)).toMatchObject({
      ok: false,
      error: "scoring_not_pending",
    });
  });

  it("treats two passes as bilateral scoring agreement", () => {
    const humanPass = passSessionTurn(createGame(), "human", 0);
    if (!humanPass.ok) throw new Error("human pass should succeed");
    const aiPass = passSessionTurn(humanPass.game, "ai", 1);

    expect(aiPass).toMatchObject({
      ok: true,
      game: { endReason: "double-pass", revision: 2 },
    });
    if (!aiPass.ok) return;
    expect(aiPass.game.scoring.status).toBe("complete");
  });
});

describe("game messages", () => {
  it("adds human and AI messages without invalidating board revision", () => {
    const game = createGame();
    const human = appendMessage(game, "human", "  Good luck!  ", 1000);
    if (!human.ok) throw new Error("human message should succeed");
    const ai = appendMessage(human.game, "ai", "Have fun.", 2000);

    expect(ai.ok).toBe(true);
    if (!ai.ok) return;
    expect(ai.game.revision).toBe(0);
    expect(
      ai.game.messages.map(({ actor, text }) => ({ actor, text })),
    ).toEqual([
      { actor: "human", text: "Good luck!" },
      { actor: "ai", text: "Have fun." },
    ]);
  });

  it("rejects blank, oversized, and rapid duplicate messages", () => {
    const game = createGame();
    expect(appendMessage(game, "human", "   ")).toEqual({
      ok: false,
      error: "message_empty",
    });
    expect(appendMessage(game, "human", "x".repeat(241))).toEqual({
      ok: false,
      error: "message_too_long",
    });

    const first = appendMessage(game, "human", "hello", 1000);
    if (!first.ok) throw new Error("first message should succeed");
    expect(appendMessage(first.game, "human", "hello", 2000)).toEqual({
      ok: false,
      error: "message_duplicate",
    });
  });
});
