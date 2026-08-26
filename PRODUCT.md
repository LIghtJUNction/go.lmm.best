# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

The product source contains a Vite + React + TypeScript client and a same-origin Bun/SQLite share relay. The relay provides read-only SSE spectating and seven-day snapshot retention but is not claimed as deployed until production verification. Passkey identity, persistent queues, and recovery remain follow-up work.

## Users

- Human players who want to enter a lightweight Go match by clicking one clear action.
- AI agents operating through a WebMCP-capable browser host, which join and play through registered page tools.
- Anonymous spectators who open an unguessable read-only link without entering either matchmaking queue.

## Product Purpose

`go.lmm.best` creates a shared Go room between a person and an AI agent. Success in the basic release means either participant can enter the page-local queue first, the AI can discover and call the WebMCP tools, and both can complete an honest, visible game.

## Positioning

The match is not a conventional human-versus-bot widget: the human enters through the interface while the AI enters through the browser's WebMCP tool boundary, and both sides meet in the same visible room state.

## Operating Context

- The human keeps the browser room open while waiting for an agent.
- The agent calls `join_go_match` with its real `modelId`, reads compact coordinate state, acts through WebMCP, then uses `wait_for_go_turn` instead of polling; a human message wakes the same wait through a cursor separate from the move revision.
- The basic release models separate human and AI FIFO queues inside one open page; it labels counts as local until a real-time backend is connected.
- After matching, the human chooses a 9×9, 13×13, or 19×19 board before the game starts.
- The player page remains the game authority. While sharing is active it publishes sanitized snapshots; if it closes, spectators retain the last position and see the host as offline.
- Cross-browser queues and recovery belong to the backend follow-up.
- English is the default public product language; Chinese remains available through the language switch.

## Capabilities and Constraints

- Domain: `go.lmm.best`.
- Guests can play without an account. Optional persistent identity will use WebAuthn Passkeys as its only registration and login method; passwords, codes, and OAuth remain excluded.
- AI matchmaking and game actions use WebMCP tools; `join_go_match` rejects calls without a non-empty `modelId`.
- Humans and AIs have separate FIFO queue roles. Either side may wait first inside the current page.
- The interface distinguishes local counts from future site-wide backend counts.
- Rules cover alternating turns, capture, suicide and repetition prevention, pass, resign, and Chinese-style area scoring with 7.5 komi on 9×9, 13×13, and 19×19 boards.
- Players may exchange bounded messages. Board-overlay comments remain off by default and can be disabled at any time.
- Players may generate a share link. Spectators are capped at 50 per game and 1000 connections globally, cannot mutate the room, and never receive host credentials or WebMCP tools.
- Share snapshots persist for seven days after the last host update; the host can revoke a link immediately.
- WebMCP capability must be feature-detected; native WebMCP and the controlled CDP compatibility bridge must be distinguished honestly.
- Adjustable AI difficulty is not a product goal. Ranking, clocks, spectator chat, SGF workflows, and anti-cheat remain future decisions.

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
6. Require revision checks for every WebMCP state-changing action.
7. Keep Passkey identity optional for play while making it the only account method.

## Accessibility & Inclusion

The board and all primary controls must be keyboard reachable and expose meaningful accessible names. Chinese and English copy must fit mobile and desktop layouts without truncating the main action or game state.
