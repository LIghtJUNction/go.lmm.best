import { describe, expect, it } from "vitest";
import {
  applyMove,
  calculateAreaScore,
  createBoard,
  getGroup,
  getLiberties,
  serializeBoard,
  type Board,
} from "./go";

describe("Go rule engine", () => {
  it("creates an empty board with a stable position hash", () => {
    const board = createBoard(3);
    expect(board).toHaveLength(3);
    expect(serializeBoard(board)).toBe(".../.../...");
  });

  it("captures an opponent group with no liberties", () => {
    const board: Board = [
      [null, "black", null],
      ["black", "white", null],
      [null, "black", null],
    ];

    const result = applyMove(board, { x: 2, y: 1 }, "black");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.captured).toBe(1);
    expect(result.board[1][1]).toBeNull();
    expect(result.board[1][2]).toBe("black");
  });

  it("rejects self-capture", () => {
    const board: Board = [
      [null, "black", null],
      ["black", null, "black"],
      [null, "black", null],
    ];

    expect(applyMove(board, { x: 1, y: 1 }, "white")).toEqual({
      ok: false,
      error: "suicide",
    });
  });

  it("rejects an immediate ko recapture that repeats the prior board", () => {
    const board: Board = [
      [null, "black", "white", null],
      ["black", "white", null, "white"],
      [null, "black", "white", null],
      [null, null, null, null],
    ];
    const capture = applyMove(board, { x: 2, y: 1 }, "black");
    if (!capture.ok) throw new Error("ko capture fixture should be legal");

    const seenPositions = new Set([
      serializeBoard(board),
      serializeBoard(capture.board),
    ]);
    expect(
      applyMove(capture.board, { x: 1, y: 1 }, "white", seenPositions),
    ).toEqual({ ok: false, error: "repetition" });
  });

  it("calculates groups and unique liberties", () => {
    const board: Board = [
      ["black", "black", null],
      [null, "black", null],
      [null, null, null],
    ];

    const group = getGroup(board, { x: 0, y: 0 });
    const liberties = getLiberties(board, group);

    expect(group).toHaveLength(3);
    expect(liberties).toHaveLength(4);
  });

  it("rejects occupied and out-of-bounds intersections", () => {
    const board = createBoard(3);
    board[0][0] = "black";

    expect(applyMove(board, { x: 0, y: 0 }, "white")).toEqual({
      ok: false,
      error: "occupied",
    });
    expect(applyMove(board, { x: 3, y: 0 }, "white")).toEqual({
      ok: false,
      error: "occupied",
    });
  });

  it("scores enclosed territory with Chinese-style area scoring", () => {
    const board: Board = [
      ["black", "black", "black"],
      ["black", null, "black"],
      ["black", "black", "black"],
    ];

    expect(calculateAreaScore(board, 0)).toMatchObject({
      black: { stones: 8, territory: 1, total: 9 },
      white: { stones: 0, territory: 0, total: 0 },
      neutral: 0,
      winner: "black",
      margin: 9,
    });
  });

  it("leaves shared empty regions neutral", () => {
    const board: Board = [
      ["black", null, "white"],
      [null, null, null],
      [null, null, null],
    ];

    expect(calculateAreaScore(board, 0)).toMatchObject({
      black: { stones: 1, territory: 0, total: 1 },
      white: { stones: 1, territory: 0, total: 1 },
      neutral: 7,
      winner: "tie",
      margin: 0,
    });
  });

  it("applies the default 7.5-point komi", () => {
    expect(calculateAreaScore(createBoard(9))).toMatchObject({
      komi: 7.5,
      white: { total: 7.5 },
      winner: "white",
      margin: 7.5,
    });
  });
});
