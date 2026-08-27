import { describe, expect, it } from "vitest";

import { appendMessage, createGame, resignSessionGame } from "./session.js";
import {
  createShareSnapshot,
  parseShareSnapshot,
  SHARE_ID_PATTERN,
  shareIdFromPath,
  sharePath,
  spectatorGameToGameState,
} from "./share.js";

describe("share snapshots", () => {
  it("projects only spectator-safe state and clones mutable collections", () => {
    const base = createGame("provider/model", 9);
    const messaged = appendMessage(base, "human", "Good luck");
    if (!messaged.ok) throw new Error(messaged.error);

    const snapshot = createShareSnapshot(messaged.game, "playing", "real");
    expect(snapshot).not.toBeNull();
    expect(snapshot?.game).not.toHaveProperty("positionHistory");
    expect(snapshot?.game).not.toHaveProperty("nextMessageId");
    expect(snapshot?.game.messages).toEqual([
      expect.objectContaining({ actor: "human", text: "Good luck" }),
    ]);

    messaged.game.board[0][0] = "black";
    messaged.game.messages[0].text = "changed";
    expect(snapshot?.game.board[0][0]).toBeNull();
    expect(snapshot?.game.messages[0].text).toBe("Good luck");
  });

  it("round-trips a spectator state into the existing read-only room model", () => {
    const snapshot = createShareSnapshot(
      createGame("provider/model", 13),
      "playing",
      "demo",
    );
    if (!snapshot) throw new Error("snapshot missing");

    const game = spectatorGameToGameState(snapshot.game);
    expect(game.boardSize).toBe(13);
    expect(game.positionHistory).toEqual([]);
    expect(game.nextMessageId).toBe(1);
  });

  it("keeps long, legal-size 19x19 histories shareable", () => {
    const game = createGame("provider/model", 19);
    game.moves = Array.from({ length: 364 }, (_, index) => ({
      number: index + 1,
      point: { x: index % 19, y: Math.floor(index / 19) % 19 },
      stone: index % 2 === 0 ? ("black" as const) : ("white" as const),
      captured: 0,
      actor: index % 2 === 0 ? ("human" as const) : ("ai" as const),
    }));
    game.revision = game.moves.length;

    const snapshot = createShareSnapshot(game, "playing", "real");

    expect(snapshot?.game.moves).toHaveLength(364);
    expect(parseShareSnapshot(snapshot)).toEqual(snapshot);
  });

  it("rejects malformed boards, move coordinates, and view/end mismatches", () => {
    const snapshot = createShareSnapshot(
      createGame("provider/model"),
      "playing",
      "real",
    );
    if (!snapshot) throw new Error("snapshot missing");

    expect(
      parseShareSnapshot({
        ...snapshot,
        game: { ...snapshot.game, board: [[null]] },
      }),
    ).toBeNull();
    expect(
      parseShareSnapshot({
        ...snapshot,
        game: {
          ...snapshot.game,
          moves: [
            {
              number: 1,
              point: { x: 12, y: 0 },
              stone: "black",
              captured: 0,
              actor: "human",
            },
          ],
        },
      }),
    ).toBeNull();
    expect(
      parseShareSnapshot({
        ...snapshot,
        game: {
          ...snapshot.game,
          moves: [
            {
              number: 1,
              point: { x: 0, y: 0 },
              stone: "black",
              captured: 0,
              actor: "human",
              pass: true,
            },
          ],
        },
      }),
    ).toBeNull();
    expect(
      parseShareSnapshot({
        ...snapshot,
        game: {
          ...snapshot.game,
          messages: [
            {
              id: 1,
              actor: "human",
              text: "out of sequence",
              moveNumber: 1,
              createdAt: Date.now(),
            },
          ],
        },
      }),
    ).toBeNull();
    expect(parseShareSnapshot({ ...snapshot, view: "finished" })).toBeNull();
  });

  it("accepts a terminal game only as a finished share", () => {
    const resigned = resignSessionGame(createGame("provider/model"), "human");
    if (!resigned.ok) throw new Error(resigned.error);
    const snapshot = createShareSnapshot(resigned.game, "finished", "real");

    expect(parseShareSnapshot(snapshot)).toEqual(snapshot);
  });
});

describe("share routes", () => {
  const id = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

  it("builds and parses opaque watch paths", () => {
    expect(SHARE_ID_PATTERN.test(id)).toBe(true);
    expect(sharePath(id)).toBe(`/watch/${id}`);
    expect(shareIdFromPath(`/watch/${id}`)).toBe(id);
    expect(shareIdFromPath(`/watch/${id}/`)).toBe(id);
  });

  it("rejects malformed or nested paths", () => {
    expect(shareIdFromPath("/watch/short")).toBeNull();
    expect(shareIdFromPath(`/watch/${id}/extra`)).toBeNull();
    expect(() => sharePath("../secret")).toThrow("Invalid share ID");
  });
});
