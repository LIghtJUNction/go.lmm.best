export const WHITE_KOMI = 7.5;

export type Stone = "black" | "white";
export type Cell = Stone | null;
export type Board = Cell[][];

export type Point = {
  x: number;
  y: number;
};

export const GO_COLUMNS = "ABCDEFGHJKLMNOPQRST";

export function formatGoCoordinate(point: Point, boardSize: number): string {
  const column = GO_COLUMNS[point.x];
  const row = boardSize - point.y;
  return column && row >= 1 && row <= boardSize ? `${column}${row}` : "";
}

export function parseGoCoordinate(
  coordinate: string,
  boardSize: number,
): Point | null {
  const match = coordinate
    .trim()
    .toUpperCase()
    .match(/^([A-HJ-T])(1[0-9]|[1-9])$/);
  if (!match) return null;
  const x = GO_COLUMNS.indexOf(match[1]);
  const row = Number(match[2]);
  if (x < 0 || x >= boardSize || row < 1 || row > boardSize) return null;
  return { x, y: boardSize - row };
}

export function formatGoBoardForAgent(board: Board) {
  const boardSize = board.length;
  const columns = GO_COLUMNS.slice(0, boardSize).split("");
  const stones = { black: [] as string[], white: [] as string[] };
  let emptyCount = 0;
  const rows = board.map((row, y) => {
    const cells = row.map((cell, x) => {
      if (!cell) {
        emptyCount += 1;
        return ".";
      }
      stones[cell].push(formatGoCoordinate({ x, y }, boardSize));
      return cell === "black" ? "X" : "O";
    });
    return `${String(boardSize - y).padStart(2, " ")} ${cells.join(" ")}`;
  });

  return {
    coordinateSystem:
      "Standard Go coordinates: columns A-T omit I; row 1 is the bottom edge.",
    legend: "X black, O white, . empty",
    diagram: [`   ${columns.join(" ")}`, ...rows].join("\n"),
    black: stones.black,
    white: stones.white,
    emptyCount,
  };
}

export type MoveError = "occupied" | "suicide" | "repetition";

export type MoveResult =
  | {
      ok: true;
      board: Board;
      captured: number;
    }
  | {
      ok: false;
      error: MoveError;
    };

export type AreaScoreSide = {
  stones: number;
  territory: number;
  total: number;
};

export type AreaScore = {
  method: "chinese-tromp-taylor-area";
  komi: number;
  black: AreaScoreSide;
  white: AreaScoreSide;
  neutral: number;
  winner: Stone | "tie";
  margin: number;
};

export function createBoard(size = 9): Board {
  return Array.from({ length: size }, () => Array<Cell>(size).fill(null));
}

export function otherStone(stone: Stone): Stone {
  return stone === "black" ? "white" : "black";
}

function isOnBoard(board: Board, point: Point): boolean {
  return (
    point.y >= 0 &&
    point.x >= 0 &&
    point.y < board.length &&
    point.x < board.length
  );
}

function neighbors(board: Board, point: Point): Point[] {
  return [
    { x: point.x - 1, y: point.y },
    { x: point.x + 1, y: point.y },
    { x: point.x, y: point.y - 1 },
    { x: point.x, y: point.y + 1 },
  ].filter((neighbor) => isOnBoard(board, neighbor));
}

export function getGroup(board: Board, start: Point): Point[] {
  const stone = board[start.y]?.[start.x];
  if (!stone) return [];

  const group: Point[] = [];
  const visited = new Set<string>();
  const stack = [start];

  while (stack.length > 0) {
    const point = stack.pop()!;
    const key = `${point.x}:${point.y}`;
    if (visited.has(key)) continue;
    visited.add(key);

    if (board[point.y]?.[point.x] !== stone) continue;
    group.push(point);

    for (const neighbor of neighbors(board, point)) {
      if (!visited.has(`${neighbor.x}:${neighbor.y}`)) stack.push(neighbor);
    }
  }

  return group;
}

export function getLiberties(board: Board, group: Point[]): Point[] {
  const liberties = new Map<string, Point>();
  for (const point of group) {
    for (const neighbor of neighbors(board, point)) {
      if (board[neighbor.y][neighbor.x] === null) {
        liberties.set(`${neighbor.x}:${neighbor.y}`, neighbor);
      }
    }
  }
  return [...liberties.values()];
}

function serializeCell(cell: Cell): string {
  if (cell === "black") return "b";
  if (cell === "white") return "w";
  return ".";
}

export function serializeBoard(board: Board): string {
  return board.map((row) => row.map(serializeCell).join("")).join("/");
}

export function applyMove(
  board: Board,
  point: Point,
  stone: Stone,
  seenPositions?: ReadonlySet<string>,
): MoveResult {
  if (!isOnBoard(board, point) || board[point.y][point.x] !== null) {
    return { ok: false, error: "occupied" };
  }

  const nextBoard = board.map((row) => [...row]);
  nextBoard[point.y][point.x] = stone;
  let captured = 0;

  for (const neighbor of neighbors(nextBoard, point)) {
    if (nextBoard[neighbor.y][neighbor.x] !== otherStone(stone)) continue;
    const group = getGroup(nextBoard, neighbor);
    if (getLiberties(nextBoard, group).length === 0) {
      captured += group.length;
      for (const member of group) nextBoard[member.y][member.x] = null;
    }
  }

  const ownGroup = getGroup(nextBoard, point);
  if (getLiberties(nextBoard, ownGroup).length === 0) {
    return { ok: false, error: "suicide" };
  }

  if (seenPositions?.has(serializeBoard(nextBoard))) {
    return { ok: false, error: "repetition" };
  }

  return { ok: true, board: nextBoard, captured };
}

export function calculateAreaScore(board: Board, komi = WHITE_KOMI): AreaScore {
  const stones: Record<Stone, number> = { black: 0, white: 0 };
  const territory: Record<Stone, number> = { black: 0, white: 0 };
  const visited = new Set<string>();
  let neutral = 0;

  for (let y = 0; y < board.length; y += 1) {
    for (let x = 0; x < board[y].length; x += 1) {
      const cell = board[y][x];
      if (cell) {
        stones[cell] += 1;
        continue;
      }

      const startKey = `${x}:${y}`;
      if (visited.has(startKey)) continue;

      const region: Point[] = [];
      const borders = new Set<Stone>();
      const stack: Point[] = [{ x, y }];

      while (stack.length > 0) {
        const point = stack.pop()!;
        const key = `${point.x}:${point.y}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (board[point.y][point.x] !== null) continue;
        region.push(point);

        for (const neighbor of neighbors(board, point)) {
          const neighborStone = board[neighbor.y][neighbor.x];
          if (neighborStone) borders.add(neighborStone);
          else if (!visited.has(`${neighbor.x}:${neighbor.y}`)) {
            stack.push(neighbor);
          }
        }
      }

      if (borders.size === 1) {
        territory[[...borders][0]] += region.length;
      } else {
        neutral += region.length;
      }
    }
  }

  const blackTotal = stones.black + territory.black;
  const whiteTotal = stones.white + territory.white + komi;
  const difference = blackTotal - whiteTotal;

  return {
    method: "chinese-tromp-taylor-area",
    komi,
    black: {
      stones: stones.black,
      territory: territory.black,
      total: blackTotal,
    },
    white: {
      stones: stones.white,
      territory: territory.white,
      total: whiteTotal,
    },
    neutral,
    winner: difference === 0 ? "tie" : difference > 0 ? "black" : "white",
    margin: Math.abs(difference),
  };
}

export function boardToRows(board: Board): string[][] {
  return board.map((row) => row.map((cell) => cell ?? "empty"));
}
