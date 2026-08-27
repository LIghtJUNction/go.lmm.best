export type JsonSchema = object;

type SchemaProperties = Record<string, JsonSchema>;

const GO_COORDINATE_PATTERN = "^[A-HJ-T](?:1[0-9]|[1-9])$";
const END_REASONS = ["human-resigned", "ai-resigned", "double-pass", "scored"];

function objectSchema(
  properties: SchemaProperties,
  required: string[],
  description?: string,
): JsonSchema {
  if (description) {
    return {
      type: "object",
      properties,
      required,
      additionalProperties: false,
      description,
    };
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function oneOf(...schemas: JsonSchema[]): JsonSchema {
  return { oneOf: schemas };
}

function nullable(schema: JsonSchema): JsonSchema {
  return oneOf(schema, { type: "null" });
}

function nonNegativeInteger(description: string): JsonSchema {
  return { type: "integer", minimum: 0, description };
}

function actionSuccessSchema(
  phase: "playing" | "finished" | readonly ["playing", "finished"],
): JsonSchema {
  const phaseSchema = Array.isArray(phase)
    ? { type: "string", enum: phase }
    : { type: "string", const: phase };
  return objectSchema(
    {
      ok: { type: "boolean", const: true },
      revision: nonNegativeInteger(
        "Monotonic game revision after the accepted action.",
      ),
      latestHumanMessageId: nonNegativeInteger(
        "Newest human message ID, or 0 when no human message exists.",
      ),
      phase: phaseSchema,
    },
    ["ok", "revision", "latestHumanMessageId", "phase"],
    "A revision-checked game action was accepted.",
  );
}

function failureSchema(
  errors: readonly string[],
  extraProperties: SchemaProperties = {},
  extraRequired: string[] = [],
): JsonSchema {
  return objectSchema(
    {
      ok: { type: "boolean", const: false },
      error: {
        type: "string",
        enum: errors,
        description: "Stable machine-readable error code.",
      },
      ...extraProperties,
    },
    ["ok", "error", ...extraRequired],
    "The tool did not change game state.",
  );
}

const REVISION_SCHEMA = nonNegativeInteger(
  "Monotonic game revision used for optimistic concurrency.",
);
const MESSAGE_ID_SCHEMA = nonNegativeInteger(
  "Newest human-authored message ID, or 0 when none exists.",
);
const BOARD_SIZE_SCHEMA: JsonSchema = {
  type: "integer",
  enum: [9, 13, 19],
};
const BOARD_OPTIONS_SCHEMA: JsonSchema = {
  type: "array",
  items: BOARD_SIZE_SCHEMA,
  minItems: 3,
  maxItems: 3,
  uniqueItems: true,
  description: "Supported square Go board sizes: 9, 13, and 19.",
};
const STONE_SCHEMA: JsonSchema = {
  type: "string",
  enum: ["black", "white"],
};
const ACTOR_SCHEMA: JsonSchema = {
  type: "string",
  enum: ["human", "ai"],
};
const COORDINATE_SCHEMA: JsonSchema = {
  type: "string",
  pattern: GO_COORDINATE_PATTERN,
  description:
    "Standard Go coordinate. Columns A-T omit I; row 1 is the bottom edge.",
};
const POINT_SCHEMA = objectSchema(
  {
    x: {
      type: "integer",
      minimum: 0,
      maximum: 18,
      description: "Zero-based column index from the left edge.",
    },
    y: {
      type: "integer",
      minimum: 0,
      maximum: 18,
      description: "Zero-based row index from the top edge.",
    },
  },
  ["x", "y"],
);

const AREA_SCORE_SIDE_SCHEMA = objectSchema(
  {
    stones: nonNegativeInteger("Stones of this color remaining on the board."),
    territory: nonNegativeInteger(
      "Empty intersections surrounded only by this color.",
    ),
    total: {
      type: "number",
      minimum: 0,
      description: "Area total after komi where applicable.",
    },
  },
  ["stones", "territory", "total"],
);

const AREA_SCORE_SCHEMA = objectSchema(
  {
    method: { type: "string", const: "chinese-tromp-taylor-area" },
    komi: {
      type: "number",
      const: 7.5,
      description: "Points added to White's total.",
    },
    black: AREA_SCORE_SIDE_SCHEMA,
    white: AREA_SCORE_SIDE_SCHEMA,
    neutral: nonNegativeInteger("Empty intersections owned by neither side."),
    winner: { type: "string", enum: ["black", "white"] },
    margin: {
      type: "number",
      minimum: 0.5,
      multipleOf: 0.5,
      description:
        "Absolute winning margin. Fixed 7.5 komi makes a tie impossible.",
    },
  },
  ["method", "komi", "black", "white", "neutral", "winner", "margin"],
  "Chinese Tromp-Taylor-style area score with White receiving 7.5 komi.",
);

const SCORING_IDLE_SCHEMA = objectSchema(
  { status: { type: "string", const: "idle" } },
  ["status"],
  "No scoring decision is pending.",
);
const SCORING_PENDING_SCHEMA = objectSchema(
  {
    status: { type: "string", const: "pending" },
    requestedBy: { type: "string", const: "human" },
    requestRevision: REVISION_SCHEMA,
    preview: AREA_SCORE_SCHEMA,
  },
  ["status", "requestedBy", "requestRevision", "preview"],
  "The human requested scoring and the AI must accept or reject it.",
);
const SCORING_COMPLETE_SCHEMA = objectSchema(
  {
    status: { type: "string", const: "complete" },
    result: AREA_SCORE_SCHEMA,
  },
  ["status", "result"],
  "Scoring is final.",
);
const SCORING_SCHEMA = oneOf(
  SCORING_IDLE_SCHEMA,
  SCORING_PENDING_SCHEMA,
  SCORING_COMPLETE_SCHEMA,
);

const AGENT_BOARD_SCHEMA = objectSchema(
  {
    coordinateSystem: {
      type: "string",
      const:
        "Standard Go coordinates: columns A-T omit I; row 1 is the bottom edge.",
    },
    legend: { type: "string", const: "X black, O white, . empty" },
    diagram: {
      type: "string",
      minLength: 1,
      description:
        "ASCII board with column labels followed by rows from the top edge to row 1.",
    },
    black: {
      type: "array",
      items: COORDINATE_SCHEMA,
      uniqueItems: true,
      description: "Coordinates occupied by Black stones.",
    },
    white: {
      type: "array",
      items: COORDINATE_SCHEMA,
      uniqueItems: true,
      description: "Coordinates occupied by White stones.",
    },
    emptyCount: nonNegativeInteger("Number of empty intersections."),
  },
  ["coordinateSystem", "legend", "diagram", "black", "white", "emptyCount"],
  "Agent-friendly board representation derived from the authoritative grid.",
);

const PLACED_MOVE_SCHEMA = objectSchema(
  {
    number: { type: "integer", minimum: 1 },
    point: POINT_SCHEMA,
    stone: STONE_SCHEMA,
    captured: nonNegativeInteger("Opponent stones captured by this move."),
    actor: ACTOR_SCHEMA,
    coordinate: COORDINATE_SCHEMA,
  },
  ["number", "point", "stone", "captured", "actor", "coordinate"],
  "A stone-placement move.",
);

const PASS_MOVE_SCHEMA = objectSchema(
  {
    number: { type: "integer", minimum: 1 },
    stone: STONE_SCHEMA,
    captured: { type: "integer", const: 0 },
    actor: ACTOR_SCHEMA,
    pass: { type: "boolean", const: true },
    coordinate: { type: "string", const: "pass" },
  },
  ["number", "stone", "captured", "actor", "pass", "coordinate"],
  "A pass move.",
);

const MESSAGE_SCHEMA = objectSchema(
  {
    id: { type: "integer", minimum: 1 },
    actor: ACTOR_SCHEMA,
    text: { type: "string", minLength: 1, maxLength: 240 },
    moveNumber: nonNegativeInteger(
      "Number of moves already played when the message was sent.",
    ),
    createdAt: nonNegativeInteger("Unix timestamp in milliseconds."),
  },
  ["id", "actor", "text", "moveNumber", "createdAt"],
);

const ACTIVE_STATE_PROPERTIES: SchemaProperties = {
  boardSize: BOARD_SIZE_SCHEMA,
  board: AGENT_BOARD_SCHEMA,
  turn: STONE_SCHEMA,
  turnActor: ACTOR_SCHEMA,
  aiColor: STONE_SCHEMA,
  humanColor: STONE_SCHEMA,
  captures: objectSchema(
    {
      black: nonNegativeInteger("White stones captured by Black."),
      white: nonNegativeInteger("Black stones captured by White."),
    },
    ["black", "white"],
  ),
  moves: {
    type: "array",
    items: oneOf(PLACED_MOVE_SCHEMA, PASS_MOVE_SCHEMA),
    description: "Complete ordered move history for the current page session.",
  },
  lastMove: nullable(
    oneOf(COORDINATE_SCHEMA, { type: "string", const: "pass" }),
  ),
  scoring: SCORING_SCHEMA,
  messages: {
    type: "array",
    items: MESSAGE_SCHEMA,
    maxItems: 100,
    description: "Bounded in-game message history.",
  },
  endReason: nullable({ type: "string", enum: END_REASONS }),
};

const ACTIVE_STATE_REQUIRED = [
  "boardSize",
  "board",
  "turn",
  "turnActor",
  "aiColor",
  "humanColor",
  "captures",
  "moves",
  "lastMove",
  "scoring",
  "messages",
  "endReason",
];

type StateSchemaOptions = {
  phase: JsonSchema;
  actionRequired: JsonSchema;
  phaseProperties: SchemaProperties;
  phaseRequired: string[];
  description: string;
  extraProperties?: SchemaProperties;
  extraRequired?: string[];
};

function stateSchema({
  phase,
  actionRequired,
  phaseProperties,
  phaseRequired,
  description,
  extraProperties = {},
  extraRequired = [],
}: StateSchemaOptions): JsonSchema {
  return objectSchema(
    {
      ok: { type: "boolean", const: true },
      phase,
      revision: REVISION_SCHEMA,
      latestHumanMessageId: MESSAGE_ID_SCHEMA,
      actionRequired,
      ...phaseProperties,
      ...extraProperties,
    },
    [
      "ok",
      "phase",
      "revision",
      "latestHumanMessageId",
      "actionRequired",
      ...phaseRequired,
      ...extraRequired,
    ],
    description,
  );
}

function idleStateSchema(
  extraProperties: SchemaProperties = {},
  extraRequired: string[] = [],
): JsonSchema {
  return stateSchema({
    phase: { type: "string", const: "idle" },
    actionRequired: { type: "string", const: "join_go_match" },
    phaseProperties: {},
    phaseRequired: [],
    description: "No queue or game is active.",
    extraProperties,
    extraRequired,
  });
}

function queueStateSchema(
  extraProperties: SchemaProperties = {},
  extraRequired: string[] = [],
): JsonSchema {
  return stateSchema({
    phase: { type: "string", const: "queue" },
    actionRequired: {
      type: "string",
      enum: ["join_go_match", "wait_for_go_turn"],
    },
    phaseProperties: {
      queueSide: nullable({ type: "string", enum: ["human", "ai"] }),
      queuePosition: { type: "integer", const: 1 },
      modelId: nullable({ type: "string", minLength: 1, maxLength: 120 }),
    },
    phaseRequired: ["queueSide", "queuePosition", "modelId"],
    description: "One side is waiting in the page-local FIFO queue.",
    extraProperties,
    extraRequired,
  });
}

function setupStateSchema(
  extraProperties: SchemaProperties = {},
  extraRequired: string[] = [],
): JsonSchema {
  return stateSchema({
    phase: { type: "string", const: "setup" },
    actionRequired: { type: "string", const: "wait_for_go_turn" },
    phaseProperties: {
      modelId: { type: "string", minLength: 1, maxLength: 120 },
      boardOptions: BOARD_OPTIONS_SCHEMA,
      defaultBoardSize: { type: "integer", const: 9 },
      message: { type: "string", minLength: 1 },
    },
    phaseRequired: ["modelId", "boardOptions", "defaultBoardSize", "message"],
    description: "The human must select a board size before play begins.",
    extraProperties,
    extraRequired,
  });
}

type ActiveStateSchemaOptions = {
  phase: "playing" | "finished";
  actionRequired: JsonSchema;
  endReason: JsonSchema;
  description: string;
  extraProperties?: SchemaProperties;
  extraRequired?: string[];
};

function activeStateSchema({
  phase,
  actionRequired,
  endReason,
  description,
  extraProperties = {},
  extraRequired = [],
}: ActiveStateSchemaOptions): JsonSchema {
  return stateSchema({
    phase: { type: "string", const: phase },
    actionRequired,
    phaseProperties: {
      ...ACTIVE_STATE_PROPERTIES,
      endReason,
    },
    phaseRequired: ACTIVE_STATE_REQUIRED,
    description,
    extraProperties,
    extraRequired,
  });
}

function playingStateSchema(
  extraProperties: SchemaProperties = {},
  extraRequired: string[] = [],
): JsonSchema {
  return activeStateSchema({
    phase: "playing",
    actionRequired: {
      type: "string",
      enum: [
        "respond_go_scoring",
        "play_go_move, pass_go_turn, or resign_go_game",
        "wait_for_go_turn",
      ],
    },
    endReason: { type: "null" },
    description: "Full playable game state.",
    extraProperties,
    extraRequired,
  });
}

function finishedStateSchema(
  extraProperties: SchemaProperties = {},
  extraRequired: string[] = [],
): JsonSchema {
  return activeStateSchema({
    phase: "finished",
    actionRequired: { type: "string", const: "game_finished" },
    endReason: { type: "string", enum: END_REASONS },
    description: "Full finished game state.",
    extraProperties,
    extraRequired,
  });
}

function stateSuccessBranches(): JsonSchema[] {
  return [
    idleStateSchema(),
    queueStateSchema(),
    setupStateSchema(),
    playingStateSchema(),
    finishedStateSchema(),
  ];
}

const CURRENT_REVISION_PROPERTY: SchemaProperties = {
  currentRevision: REVISION_SCHEMA,
};

const WAIT_REQUIRED = [
  "waitStatus",
  "waitReason",
  "afterRevision",
  "afterMessageId",
];

function waitProperties(
  waitStatus: "ready" | "waiting" | "stopped",
  waitReason:
    | "room_stopped"
    | "game_finished"
    | "scoring"
    | "human_message"
    | "ai_turn"
    | "timeout",
  stateConstraints: SchemaProperties = {},
): SchemaProperties {
  return {
    ...stateConstraints,
    waitStatus: {
      type: "string",
      const: waitStatus,
      description: "Whether the caller should act, wait again, or stop.",
    },
    waitReason: { type: "string", const: waitReason },
    afterRevision: REVISION_SCHEMA,
    afterMessageId: MESSAGE_ID_SCHEMA,
  };
}

function waitSuccessBranches(): JsonSchema[] {
  return [
    idleStateSchema(waitProperties("stopped", "room_stopped"), WAIT_REQUIRED),
    queueStateSchema(waitProperties("waiting", "timeout"), WAIT_REQUIRED),
    setupStateSchema(waitProperties("waiting", "timeout"), WAIT_REQUIRED),
    playingStateSchema(
      waitProperties("waiting", "timeout", {
        turnActor: { type: "string", const: "human" },
        scoring: SCORING_IDLE_SCHEMA,
      }),
      WAIT_REQUIRED,
    ),
    playingStateSchema(
      waitProperties("ready", "human_message", {
        scoring: SCORING_IDLE_SCHEMA,
      }),
      WAIT_REQUIRED,
    ),
    playingStateSchema(
      waitProperties("ready", "ai_turn", {
        turnActor: { type: "string", const: "ai" },
        scoring: SCORING_IDLE_SCHEMA,
      }),
      WAIT_REQUIRED,
    ),
    playingStateSchema(
      waitProperties("ready", "scoring", {
        scoring: SCORING_PENDING_SCHEMA,
      }),
      WAIT_REQUIRED,
    ),
    finishedStateSchema(
      waitProperties("ready", "game_finished"),
      WAIT_REQUIRED,
    ),
  ];
}

export const WEBMCP_OUTPUT_SCHEMAS = {
  join_go_match: {
    description: "Queued, matched, or rejected matchmaking result.",
    oneOf: [
      objectSchema(
        {
          ok: { type: "boolean", const: true },
          status: { type: "string", const: "queued" },
          queueSide: { type: "string", const: "ai" },
          queuePosition: { type: "integer", const: 1 },
          modelId: { type: "string", minLength: 1, maxLength: 120 },
          revision: REVISION_SCHEMA,
          latestHumanMessageId: MESSAGE_ID_SCHEMA,
          actionRequired: { type: "string", const: "wait_for_go_turn" },
        },
        [
          "ok",
          "status",
          "queueSide",
          "queuePosition",
          "revision",
          "latestHumanMessageId",
          "actionRequired",
        ],
      ),
      objectSchema(
        {
          ok: { type: "boolean", const: true },
          status: { type: "string", const: "matched" },
          phase: { type: "string", const: "setup" },
          modelId: { type: "string", minLength: 1, maxLength: 120 },
          revision: REVISION_SCHEMA,
          latestHumanMessageId: MESSAGE_ID_SCHEMA,
          defaultBoardSize: { type: "integer", const: 9 },
          boardOptions: BOARD_OPTIONS_SCHEMA,
          actionRequired: { type: "string", const: "wait_for_go_turn" },
        },
        [
          "ok",
          "status",
          "phase",
          "modelId",
          "revision",
          "latestHumanMessageId",
          "defaultBoardSize",
          "boardOptions",
          "actionRequired",
        ],
      ),
      failureSchema([
        "model_id_required",
        "ai_queue_occupied",
        "already_matched",
      ]),
    ],
  },
  get_go_game_state: {
    description:
      "Phase-discriminated room state. Playing and finished phases include the full board, moves, captures, scoring, messages, and revision.",
    oneOf: stateSuccessBranches(),
  },
  wait_for_go_turn: {
    description:
      "Phase-discriminated state plus the wait outcome and acknowledged revision/message cursors.",
    oneOf: [
      ...waitSuccessBranches(),
      failureSchema([
        "invalid_revision",
        "invalid_message_id",
        "invalid_timeout",
      ]),
      failureSchema(["future_revision"], { currentRevision: REVISION_SCHEMA }, [
        "currentRevision",
      ]),
      failureSchema(
        ["future_message_id"],
        { currentMessageId: MESSAGE_ID_SCHEMA },
        ["currentMessageId"],
      ),
    ],
  },
  play_go_move: {
    description: "Accepted move or a precise validation/concurrency error.",
    oneOf: [
      actionSuccessSchema("playing"),
      failureSchema([
        "invalid_coordinate",
        "invalid_revision",
        "game_not_playable",
      ]),
      failureSchema(
        [
          "wrong_turn",
          "scoring_pending",
          "stale_state",
          "occupied",
          "suicide",
          "repetition",
        ],
        CURRENT_REVISION_PROPERTY,
        ["currentRevision"],
      ),
    ],
  },
  pass_go_turn: {
    description:
      "Accepted pass (possibly ending the game after two passes) or a validation/concurrency error.",
    oneOf: [
      actionSuccessSchema(["playing", "finished"]),
      failureSchema(["invalid_revision", "game_not_playable"]),
      failureSchema(
        ["wrong_turn", "scoring_pending", "stale_state"],
        CURRENT_REVISION_PROPERTY,
        ["currentRevision"],
      ),
    ],
  },
  resign_go_game: {
    description: "Accepted resignation or a validation/concurrency error.",
    oneOf: [
      actionSuccessSchema("finished"),
      failureSchema(["invalid_revision", "game_not_playable"]),
      failureSchema(["stale_state"], CURRENT_REVISION_PROPERTY, [
        "currentRevision",
      ]),
    ],
  },
  respond_go_scoring: {
    description: "Accepted scoring decision or a validation/concurrency error.",
    oneOf: [
      actionSuccessSchema(["playing", "finished"]),
      failureSchema([
        "invalid_scoring_decision",
        "invalid_revision",
        "game_not_playable",
      ]),
      failureSchema(
        ["stale_state", "scoring_not_pending"],
        CURRENT_REVISION_PROPERTY,
        ["currentRevision"],
      ),
    ],
  },
  send_go_message: {
    description: "Accepted bounded message or a message/game-state error.",
    oneOf: [
      objectSchema(
        {
          ok: { type: "boolean", const: true },
          messageId: { type: "integer", minimum: 1 },
          latestHumanMessageId: MESSAGE_ID_SCHEMA,
        },
        ["ok", "messageId", "latestHumanMessageId"],
      ),
      failureSchema([
        "message_required",
        "game_not_playable",
        "message_empty",
        "message_too_long",
        "message_duplicate",
      ]),
    ],
  },
} as const satisfies Record<string, JsonSchema>;
