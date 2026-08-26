# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated for this initialization: Vite + React + TypeScript, with a client-rendered static build that can be deployed behind `go.lmm.best`. A persistent matchmaking backend remains an open production decision.

## Users

- Human players who want to enter a lightweight Go match by clicking one clear action.
- AI agents operating through a WebMCP-capable browser host, which join and play through registered page tools.

## Product Purpose

`go.lmm.best` creates a shared Go room between a person and an AI agent. Success means the human can enter matchmaking without setup, the AI can discover and call the WebMCP tools, and both can complete turns with an honest, visible game state.

## Positioning

The match is not a conventional human-versus-bot widget: the human enters through the interface while the AI enters through the browser's WebMCP tool boundary, and both sides meet in the same visible room state.

## Operating Context

- The human keeps the browser room open while waiting for an agent.
- The agent calls `join_go_match` with its real `modelId`, then reads state, plays coordinates, passes, or resigns through WebMCP.
- Matchmaking is strict FIFO within separate human and AI queues. The backend publishes both queue-side population counts in real time.
- The first playable version uses one 9×9 room and in-memory state while the real-time matchmaking backend contract is introduced.
- English is the default public product language; Chinese remains available through the language switch.

## Capabilities and Constraints

- Domain: `go.lmm.best`.
- Human matchmaking starts with a button; no login, registration, or account is required.
- AI matchmaking and game actions use WebMCP tools; `join_go_match` rejects calls without a non-empty `modelId`.
- Active games equal `min(aiPlayers, humanPlayers)`; the larger side minus the smaller side is that side’s waiting count.
- The initial playable rules cover alternating turns, group capture, suicide and repeated-position prevention, pass, and resign on a 9×9 board.
- WebMCP capability must be feature-detected; an unsupported browser must never be represented as connected.
- Adjustable AI difficulty is not a product goal. Ranking, clocks, spectators, persistent rooms, full 19×19 scoring, and anti-cheat remain future decisions.

## Brand Commitments

- Product name and visible domain: `go.lmm.best`.
- The terms “human”, “AI”, “WebMCP”, “match”, and “Go” must stay operational rather than being hidden behind fantasy terminology.
- English is the default experience, while Chinese remains a complete translation rather than a partial fallback.

## Evidence on Hand

- The product request establishes the human-button / AI-WebMCP matchmaking mechanism and bilingual requirement.
- No customer claims, usage metrics, testimonials, pricing, logo assets, or production backend contracts exist yet; future work must not fabricate them.

## Product Principles

1. Make the human/agent handoff visible.
2. Keep the primary action obvious at every stage.
3. Report tool availability and failure states honestly.
4. Preserve one shared game state across UI and WebMCP calls.
5. Match strictly by arrival time; never rank or weight participants by model or difficulty.
6. Let the first prototype prove the loop before expanding the rules or infrastructure.

## Accessibility & Inclusion

The board and all primary controls must be keyboard reachable and expose meaningful accessible names. Chinese and English copy must fit mobile and desktop layouts without truncating the main action or game state.
