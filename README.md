# Human vs. AI Go, Powered by WebMCP

![go.lmm.best — Human versus AI Go through WebMCP](public/og-cover.png)

[go.lmm.best](https://go.lmm.best) is a bilingual, browser-based 9×9 Go room where a person and an AI share one rule-controlled game state through two different interfaces:

- the human joins and places stones through the visible interface;
- the AI joins, reads the board, and submits moves through WebMCP tools.

The service requires no account, login, or registration. The default interface language is English, and a complete Chinese translation remains available from the language switch.

## Inspiration

Go has extremely simple rules, yet every move can change the direction of the entire game. That contrast made it an ideal environment for exploring a larger question:

> What happens when an AI does not merely generate an answer, but directly participates in an interactive application?

Most AI board-game demos hide the interaction behind a traditional backend API. The AI receives a board state, returns a coordinate, and the application handles everything else. This project makes that interaction explicit. The human places stones naturally by clicking the board, while the AI observes the same game and makes its own moves through narrow, structured WebMCP tools.

The result is a shared digital environment where a human and an AI interact with one authoritative game state through different interfaces.

## What the Project Does

1. The human clicks **Find an opponent** and enters the room.
2. An AI agent calls `join_go_match` through WebMCP.
3. The human plays Black by clicking an empty intersection.
4. The AI reads the latest state and revision with `get_go_game_state`.
5. The AI chooses a move and calls `play_go_move` with that revision.
6. The rule engine validates the action, updates captures and turn order, and React renders the new position.

Neither participant can directly mutate the board. Every action goes through the same rule engine.

Conceptually, each accepted action follows:

$$
S_{t+1} = T(S_t, a_t)
$$

where:

- $S_t$ is the current board state;
- $a_t$ is the human or AI action;
- $T$ is the rule engine that validates and applies the action.

A move is accepted only when:

$$
a_t \in A(S_t)
$$

where $A(S_t)$ is the set of legal actions for the current position and revision.

## WebMCP Tools

The current implementation uses the imperative WebMCP API at `document.modelContext.registerTool()`. An early-preview `navigator.modelContext` fallback is retained for older hosts.

| Tool | Purpose | Important input |
| --- | --- | --- |
| `join_go_match` | Join the oldest waiting human and begin the game | required `modelId`; optional AI display name |
| `get_go_game_state` | Read room status, board, turn, captures, moves, position hash, and revision | none |
| `play_go_move` | Submit a legal AI move | `coordinate` or `x`/`y`, plus `expectedRevision` |
| `pass_go_turn` | Pass the AI turn | `expectedRevision` |
| `resign_go_game` | End the game by AI resignation | `expectedRevision` |

Example AI loop:

```text
join_go_match({ modelId: "openai/gpt-5", displayName: "WebMCP AI" })
        ↓
get_go_game_state()
        ↓
reason about the returned 9×9 board
        ↓
play_go_move({ coordinate: "E6", expectedRevision: 11 })
        ↓
read the structured tool result
```

The revision check prevents a tool call based on an older position from being applied after the human or another action has already advanced the game. `modelId` is mandatory when an AI joins and is shown to the human opponent throughout the match.

## Enable WebMCP

Use either of these paths before joining a real match:

### ChatGPT app

1. Open the ChatGPT app.
2. Open `https://go.lmm.best` with its built-in browser.
3. Ask your agent to inspect the WebMCP tools exposed by the page.
4. After the human enters matchmaking, have the agent call `join_go_match` with its real `modelId`.

### Chromium-based browser

1. Open `chrome://flags/#enable-webmcp-testing`.
2. Set **WebMCP testing** to **Enabled**.
3. Relaunch the browser.
4. Open `https://go.lmm.best`, let the page expose its WebMCP tools, and have the agent call `join_go_match` with its real `modelId`.

The AI must not invent or omit the model identifier. A join request without a non-empty `modelId` is rejected.

## Architecture

```text
src/
├── App.tsx          matchmaking, room state, board UI, and tool callbacks
├── lib/
│   ├── go.ts        pure Go rules and position serialization
│   ├── go.test.ts   capture, liberty, suicide, repetition, and bounds tests
│   ├── i18n.ts      complete English and Chinese product copy
│   └── webmcp.ts    capability detection, schemas, and tool registration
├── main.tsx         React entry point and display font
└── styles.css       responsive game-room visual system
```

### Interactive Go Board

The board converts pointer or keyboard activation into internal zero-based coordinates. It displays:

- empty intersections;
- black and white stones;
- the latest move marker;
- captured-stone counts;
- the current player;
- pass, resign, and invalid-move feedback.

The visual board never owns the rules. It requests an action and renders the resulting `GameState`.

### Go Rule Engine

`src/lib/go.ts` is the source of truth for move legality. It handles:

- turn enforcement at the room layer;
- occupied and out-of-bounds intersections;
- connected-group traversal;
- unique liberty calculation;
- captured-group removal;
- self-capture prevention;
- repeated-position prevention through positional hashes;
- pass and resign flow at the room layer.

The current prototype ends after consecutive passes but does not yet adjudicate territory. Production scoring and SGF-grade rules remain roadmap work.

### AI Interaction Layer

`src/lib/webmcp.ts` exposes only the capabilities an agent needs. Inputs use JSON Schema, read-only state inspection is annotated, and all tool registrations share an `AbortSignal` so React can cleanly unregister them.

The AI cannot click arbitrary DOM nodes, rewrite React state, or bypass the rule engine. Malformed coordinates, stale revisions, wrong-turn actions, occupied points, suicide, and repeated positions return structured failures without freezing the room.

## Running Locally

Requirements:

- Node.js 22+
- npm 12+
- a WebMCP-capable browser or host for real AI tool calls

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The room includes a local board preview when WebMCP is unavailable, but a real AI match requires a host that exposes WebMCP in a secure context.

## Quality Checks

```bash
npm test
npm run build
# or both
npm run check
```

## Deployment

Production is served from `DmitUbuntu` behind Nginx at:

```text
https://go.lmm.best
```

GitHub is the source repository, not the hosting platform. The current frontend is deployed as versioned static releases behind a `current` symlink. Future matchmaking and game-state APIs can be added behind the same Nginx entry point without introducing login or registration. WebMCP requires the production HTTPS origin.

## Challenges

### Keeping the AI and Interface Synchronized

The human interface and AI tool calls are asynchronous. Every game action carries or checks the latest revision, so an AI cannot silently apply a move based on an older board. On failure, it receives the current revision and can read state again.

### Implementing Go Rules Safely

Go looks simple until groups, liberties, captures, suicide, and repeated positions appear. The board is modeled as a graph: each stone is a node connected to orthogonal neighbors, and traversal determines group membership and liberties before a move is committed.

### Designing Tools for an AI

Broad page access would be easy but unreliable. The project instead exposes a small interface with explicit inputs, outputs, and failure modes. The AI only needs a stable board representation and a safe action boundary.

### Coordinate Conversion

The rule engine uses one zero-based coordinate system. Human-readable coordinates such as `D4` are converted only at the WebMCP boundary, preventing screen positions, array indexes, and protocol notation from leaking into one another.

### Recovering from Failed AI Actions

An AI may submit malformed parameters, choose an illegal move, act out of turn, or use stale state. The tool returns a structured reason; the game remains playable, and the AI can retrieve the latest state before trying again.

## What This Demonstrates

AI becomes more useful when it can participate in a structured environment instead of only exchanging text. WebMCP lets the application expose meaningful capabilities while the game engine remains in control.

Tool design matters as much as model intelligence. A narrow, predictable capability boundary produces safer and more understandable behavior than unrestricted access to application internals.

Most importantly, AI actions are treated as untrusted external input and validated as carefully as human actions.

## Current Scope

- One in-memory 9×9 room
- Human plays Black; WebMCP AI plays White
- Capture, liberty, suicide, positional repetition, pass, and resign handling
- English default plus complete Chinese translation
- Responsive desktop and mobile UI
- No account, login, or registration required

Reloading the page currently resets the room. Persistent matchmaking, clocks, scoring, spectators, and anti-cheat require a backend contract and are intentionally outside this first prototype. Authentication is not part of the product direction.

## Next

- 13×13 and 19×19 boards
- Territory scoring and full ko/superko policy
- Move history and SGF import/export
- Replay and position analysis
- Suggested moves for beginners
- Timed matches and spectator mode
- Multiple rooms backed by a server
- Human-versus-human and AI-versus-AI modes
- Richer AI analysis and teaching tools

The long-term goal is both a playable online Go room and a practical example of safe human–AI interaction through WebMCP.
