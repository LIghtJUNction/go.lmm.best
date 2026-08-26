# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React + TypeScript frontend behind `go.lmm.best`, plus a same-origin backend compiled as a standalone Bun executable. SQLite persists Passkey credentials, sessions, queues, games, messages, and revisions for the current single-node deployment.

## Users

- Human players who want to enter a lightweight Go match by clicking one clear action.
- AI agents operating through a WebMCP-capable browser host, which join and play through registered page tools.

## Product Purpose

`go.lmm.best` creates a persistent shared Go room between a person and an AI agent. Success means the human can authenticate with a Passkey, either participant can enter matchmaking first, the AI can discover and call the WebMCP tools, and both can resume and complete an honest, visible game.

## Positioning

The match is not a conventional human-versus-bot widget: the human enters through the interface while the AI enters through the browser's WebMCP tool boundary, and both sides meet in the same visible room state.

## Operating Context

- The human keeps the browser room open while waiting for an agent.
- The agent calls `join_go_match` with its real `modelId`, then reads state, plays coordinates, passes, or resigns through WebMCP.
- Matchmaking is strict FIFO within separate human and AI queues. The backend publishes both queue-side population counts in real time.
- After matching, the human chooses a 9×9, 13×13, or 19×19 board before the game starts.
- Queues, presence, messages, game revisions, and recoverable sessions are authoritative on the backend.
- English is the default public product language; Chinese remains available through the language switch.

## Capabilities and Constraints

- Domain: `go.lmm.best`.
- Human accounts use WebAuthn Passkeys exclusively. Passwords, email/SMS codes, and OAuth are not offered.
- Visitors may inspect the lobby, but joining a persistent human queue requires a Passkey session.
- AI matchmaking and game actions use WebMCP tools; `join_go_match` rejects calls without a non-empty `modelId`.
- Humans and AIs have separate strict FIFO queues. Either side may wait first; the oldest compatible entries match atomically.
- Published population counts come from backend queue, presence, and active-game state rather than fabricated client numbers.
- Rules cover alternating turns, capture, suicide and repetition prevention, pass, resign, and Chinese-style area scoring with 7.5 komi on 9×9, 13×13, and 19×19 boards.
- Players may exchange bounded messages. Board-overlay comments remain off by default and can be disabled at any time.
- WebMCP capability must be feature-detected; native WebMCP and the controlled CDP compatibility bridge must be distinguished honestly.
- Adjustable AI difficulty is not a product goal. Ranking, clocks, spectators, SGF workflows, and anti-cheat remain future decisions.

## Brand Commitments

- Product name and visible domain: `go.lmm.best`.
- The terms “human”, “AI”, “WebMCP”, “match”, and “Go” must stay operational rather than being hidden behind fantasy terminology.
- English is the default experience, while Chinese remains a complete translation rather than a partial fallback.

## Evidence on Hand

- The product request establishes the human-button / AI-WebMCP matchmaking mechanism and bilingual requirement.
- No customer claims, usage metrics, testimonials, or pricing exist; future work must not fabricate them.
- Production behavior must be claimed only after the backend, Passkey ceremony, recovery, and live matchmaking are deployed and verified.

## Product Principles

1. Make the human/agent handoff visible.
2. Keep the primary action obvious at every stage.
3. Report tool availability and failure states honestly.
4. Preserve one shared game state across UI and WebMCP calls.
5. Match strictly by arrival time; never rank or weight participants by model or difficulty.
6. Require revision checks and server-side validation for every state-changing action.
7. Keep authentication Passkey-only and never introduce fallback secrets.

## Accessibility & Inclusion

The board and all primary controls must be keyboard reachable and expose meaningful accessible names. Chinese and English copy must fit mobile and desktop layouts without truncating the main action or game state.
