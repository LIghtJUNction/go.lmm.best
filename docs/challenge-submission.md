# WebMCP Challenge submission

## Project

**Name:** go.lmm.best  
**Live URL:** <https://go.lmm.best>  
**Source:** <https://github.com/LIghtJUNction/go.lmm.best>  
**License:** MIT

## Submission description

### Why this use case fits WebMCP

A Go-playing agent needs an exact board, a known turn, and a legal way to act. Screen scraping turns each intersection into an ambiguous visual target. A chat-only interface makes the agent invent its own state. go.lmm.best exposes eight typed WebMCP tools for joining, reading the game, waiting without polling, playing, passing, resigning, scoring, and speaking.

The page keeps the rules. Each game action includes the revision the agent last read. The page rejects stale revisions, wrong turns, occupied points, suicide, and repeated positions. The agent can reason about Go instead of operating the interface.

### How it improves the experience

The person gets a responsive Go board with familiar controls. The agent gets structured JSON and narrow actions. Both use the same game state, move history, messages, and scoring result.

The AI may enter the queue before the human. Once matched, the human chooses 9×9, 13×13, or 19×19. After each move, the agent can block on `wait_for_go_turn` while the person thinks instead of repeatedly fetching unchanged state. A human message wakes that same wait immediately through a separate message cursor, so the agent can reply without chat invalidating the move revision. The agent can also answer a scoring request and send a message during either turn. None of these actions require a custom extension written for one model provider.

### What people and agents can do together

A person can open a public web page, invite an agent, and play a rule-checked board game through two different interfaces. The person never copies board arrays into chat. The agent never guesses which DOM node means E6. Their moves remain visible to both participants, and every write uses an explicit revision. A player may also create a read-only watch link; its route does not register WebMCP tools and spectators never enter either player queue.

### WebMCP implementation

`src/lib/webmcp.ts` builds eight tools with JSON input schemas and registers them through the imperative Model Context API. The implementation checks `document.modelContext` first and retains the early `navigator.modelContext` location for compatible preview hosts. Registrations use an `AbortSignal` for cleanup.

Hosts that expose CDP without forwarding native tools can use a controlled compatibility bridge. It exposes only `window.goWebMCP.listTools()` and `window.goWebMCP.callTool(name, input)`. It does not expose React state, the DOM, or arbitrary script helpers.

The Go rule engine and session transitions live outside the UI. Both visible controls and WebMCP callbacks call the same functions. Vitest covers captures, suicide, repeated positions, revision checks, scoring, messages, and tool schemas.

## Demo video plan

Target length: **2 minutes 35 seconds**. Record at 1440×900 with browser audio narration. Keep the URL and tool calls readable. Do not speed up the tool results.

| Time | Picture | Narration |
| --- | --- | --- |
| 0:00–0:12 | Open `go.lmm.best`; show the lobby and live URL. | “This is go.lmm.best, a Go room where a person uses the board and an AI uses WebMCP.” |
| 0:12–0:30 | Open the WebMCP tool list. Point to all eight tools. | “The page exposes typed tools for matchmaking, state, waiting, moves, passing, resigning, scoring, and messages.” |
| 0:30–0:48 | Call `join_go_match` before clicking the human action. Show the AI waiting state. | “The agent can arrive first. It identifies its real model and waits in the AI side of the queue.” |
| 0:48–1:02 | Click “Join this AI”; choose 13×13 and start. | “The human joins from the page and chooses the board only after the match forms.” |
| 1:02–1:25 | Start `wait_for_go_turn`, place a human stone, then use the returned compact board and revision with `play_go_move`. | “The agent waits without polling while the person thinks, then receives an exact coordinate board and submits one move.” |
| 1:25–1:40 | Replay the old revision and show the structured stale-revision error. | “Replaying a stale action fails. The page, not the model, owns turn and revision safety.” |
| 1:40–1:57 | While the agent waits, send one human message; show `waitReason: human_message`, reply with `send_go_message`, then briefly enable board comments. | “Conversation wakes the agent without polling or changing the move revision. Board comments remain optional.” |
| 1:57–2:18 | Human requests scoring; call `respond_go_scoring` with `accept`; show the score. | “The human asks to score. The AI accepts with the current revision, and the same rules produce the final area score with komi.” |
| 2:18–2:30 | Switch dark mode, narrow to mobile width, pan a 19×19 board. | “The room is bilingual, theme-aware, reduced-motion friendly, and usable on a phone.” |
| 2:30–2:35 | Show the GitHub repository, MIT badge, and `webmcp.ts`. | “The live app and all source are public under MIT.” |

## Recording checklist

- Use the production URL, not localhost.
- Show the browser's native WebMCP tool surface at least once.
- Keep `modelId`, the chosen coordinate, and `expectedRevision` visible.
- Include one successful action and one structured failure.
- Record clear spoken audio; avoid background music that masks narration.
- Keep the final public YouTube video under three minutes.
- Confirm the YouTube URL works in a signed-out window before submission.

## Final live verification

- [ ] `https://go.lmm.best` returns 200 without credentials.
- [ ] ChatGPT's in-app browser discovers `join_go_match`.
- [ ] Chrome 149+ with `#enable-webmcp-testing` discovers all eight tools.
- [ ] `wait_for_go_turn` resolves after a human move or message and does not poll state.
- [ ] A human message returns `waitReason: human_message` without changing the game revision.
- [ ] AI-first and human-first queue paths both reach board setup.
- [ ] A legal move succeeds with the latest revision.
- [ ] The same action fails with a stale revision.
- [ ] Scoring and messaging work.
- [ ] A watch link receives moves and messages, exposes no enabled intersections or WebMCP tools, and survives a relay restart.
- [ ] Revoking a watch link closes active spectator streams.
- [ ] English and Chinese render at 390px and desktop widths.
- [ ] Light, dark, and reduced-motion modes remain usable.
- [ ] The repository is public and GitHub detects the root MIT license.
- [ ] README setup commands work from a clean clone.
