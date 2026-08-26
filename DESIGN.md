# go.lmm.best Design System

Status: confirmed by user on 2026-08-26  
Direction: **Quiet Go Salon / 静谧棋院**

## Product Character

A calm online Go room, not a marketing landing page and not a developer console. The interface should feel like entering a contemporary Go salon: warm paper, dark ink, honest wood, quiet state changes, and enough live information to trust the match.

## Visual Principles

1. **The match leads.** Player populations, waiting math, and the primary matchmaking action appear before explanation.
2. **The board is the material center.** Wood and stones may have restrained physical depth; surrounding UI remains flat and quiet.
3. **State uses one accent.** Jade indicates available, active, selected, or successful states. Never use it as decorative neon.
4. **Readable before clever.** Ordinary body text is at least 14–16px. Metadata is never compressed into unreadable 9px labels.
5. **No giant slogan.** Product titles support the task instead of consuming the viewport.
6. **No card wall.** Use proximity, rules, and whitespace before containers. Panels exist only for operational boundaries.

## Color Roles

| Role | Token | Value |
| --- | --- | --- |
| Page paper | `--paper` | `#f4f1e8` |
| Raised paper | `--paper-raised` | `#fffdf8` |
| Quiet paper | `--paper-muted` | `#eae5d9` |
| Primary ink | `--ink` | `#20251f` |
| Secondary ink | `--ink-muted` | `#697068` |
| Hairline | `--line` | `#d2ccbe` |
| State jade | `--jade` | `#2f6b52` |
| Soft jade | `--jade-soft` | `#dce8e0` |
| Board light | `--wood-light` | `#ddb66f` |
| Board base | `--wood` | `#c9964f` |
| Destructive | `--danger` | `#9f493e` |

The palette is light-first. Dark surfaces are reserved for black stones and small high-contrast code samples, never the whole page.

## Typography

- Display: **Newsreader Variable**, 500–650 weight, sentence case. Used for page titles and important match numbers.
- Body: system sans with Chinese system fallbacks. Used for controls, explanations, metadata, and code-adjacent copy.
- Data: tabular numerals from the body family.
- Primary title: 40–64px desktop, 36–46px mobile.
- Section title: 22–30px.
- Body: 16px / 1.6.
- Operational labels: 12–14px; never smaller than 12px.

## Layout

### Lobby

Desktop uses a two-column match hall: live populations and primary action on the left, compact board preview on the right. The first viewport includes both. Supporting explanation moves below.

Mobile order:

1. Product name and short purpose
2. Human/AI live populations and match math
3. Primary join action
4. Compact board preview
5. Optional “How it works” disclosure

### Waiting

One centered match console. Show human and AI totals, calculated active games/waiting side, queue position, elapsed time, cancellation, and readable WebMCP join instructions. Avoid duplicated waiting headlines and empty decorative space.

### Game

Board-led split layout. The board stays within `min(70vh, available width)` on desktop. Player names/model IDs and turn appear above the board; captures, move log, and WebMCP tools sit in a quiet side rail. On mobile, player/turn summary comes first, board second, secondary tools below.

## Components

- Primary button: solid jade, white text, 48–52px height.
- Secondary button: paper surface with ink border.
- Status badge: soft jade with explicit text and dot; no glow.
- Population counter: large serif number, plain label, no enclosing card unless interactive.
- Code sample: ink text on quiet paper with a jade rule.
- Alert: tinted paper with clear next action; no floating glass toast aesthetic.
- Board: subtle wood grain, thin brown grid, matte stones, small last-move marker.

## Motion

Motion uses the Motion library rather than hand-built animation code.

- Page and match-state transitions use interruptible, critically damped springs around 300–400ms.
- Population numbers cross-fade and travel a few pixels when live counts change.
- The board may lift subtly on pointer hover and settles immediately when interrupted.
- Buttons respond on press through the shared shadcn component behavior.
- Stone placement uses a 140–180ms opacity/scale settle.
- Do not add orbiting decorations, pulsing glows, parallax, or motion that runs without a state cause.
- Reduced motion replaces travel with short opacity changes while preserving state feedback.

## Explicit Avoid List

- Full-page near-black background
- Neon lime accents
- Oversized condensed slogans
- Tiny tracked uppercase labels
- Decorative “AI control panel” styling
- Overlapping status cards
- Purple/blue AI gradients
- Explanatory content before the primary game action on mobile
