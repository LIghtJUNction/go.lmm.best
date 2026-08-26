import type { Point } from './go.js'

export type WebMCPStatus = 'available' | 'unsupported'

type ToolHandler = (input: unknown) => unknown | Promise<unknown>

type WebMCPTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: ToolHandler
  annotations?: {
    readOnlyHint?: boolean
  }
}

type WebMCPModelContext = {
  registerTool?: (tool: WebMCPTool, options?: { signal?: AbortSignal }) => void | Promise<void>
}

type DocumentWithModelContext = Document & {
  modelContext?: WebMCPModelContext
}

type NavigatorWithModelContext = Navigator & {
  modelContext?: WebMCPModelContext
}

export type WebMCPCallbacks = {
  joinMatch: (input: { displayName?: string }) => unknown | Promise<unknown>
  getGameState: () => unknown | Promise<unknown>
  playMove: (point: Point, expectedRevision: number) => unknown | Promise<unknown>
  passTurn: (expectedRevision: number) => unknown | Promise<unknown>
  resignGame: (expectedRevision: number) => unknown | Promise<unknown>
}

function getModelContext(): WebMCPModelContext | undefined {
  if (typeof document !== 'undefined') {
    const currentApi = (document as DocumentWithModelContext).modelContext
    if (currentApi) return currentApi
  }

  // Older early-preview builds exposed the API on navigator.
  if (typeof navigator !== 'undefined') return (navigator as NavigatorWithModelContext).modelContext
  return undefined
}

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

function parsePoint(input: unknown): Point | null {
  const values = asRecord(input)
  const x = values.x
  const y = values.y
  if (typeof x === 'number' && Number.isInteger(x) && typeof y === 'number' && Number.isInteger(y)) {
    return { x, y }
  }

  const coordinate = values.coordinate
  if (typeof coordinate === 'string') {
    const match = coordinate.trim().toUpperCase().match(/^([A-I])\s*([1-9])$/)
    if (match) {
      return { x: match[1].charCodeAt(0) - 65, y: Number(match[2]) - 1 }
    }
  }

  return null
}

function parseRevision(input: unknown): number | null {
  const revision = asRecord(input).expectedRevision
  return typeof revision === 'number' && Number.isInteger(revision) && revision >= 0 ? revision : null
}

function toolSchema(properties: Record<string, unknown> = {}, required: string[] = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }
}

export function registerWebMCPTools(callbacks: WebMCPCallbacks, onStatus: (status: WebMCPStatus) => void): () => void {
  const modelContext = getModelContext()
  const registerTool = modelContext?.registerTool?.bind(modelContext)
  if (!registerTool) {
    onStatus('unsupported')
    return () => undefined
  }

  onStatus('available')
  const tools: WebMCPTool[] = [
    {
      name: 'join_go_match',
      description: 'Join the open human-vs-AI Go room. The human must already be waiting.',
      inputSchema: toolSchema({
        displayName: { type: 'string', description: 'Optional name shown in the room. The AI plays White in this prototype.' },
      }),
      execute: async (input) => {
        const values = asRecord(input)
        return callbacks.joinMatch({
          displayName: typeof values.displayName === 'string' ? values.displayName : undefined,
        })
      },
    },
    {
      name: 'get_go_game_state',
      description: 'Read the current Go board, revision, turn, captures, move log, and room status before taking an action.',
      inputSchema: toolSchema(),
      execute: () => callbacks.getGameState(),
      annotations: { readOnlyHint: true },
    },
    {
      name: 'play_go_move',
      description: 'Play a legal move for the AI on the 9x9 Go board. Read state first, then send its revision with x/y or coordinate A1-I9.',
      inputSchema: toolSchema(
        {
          x: { type: 'integer', minimum: 0, maximum: 8 },
          y: { type: 'integer', minimum: 0, maximum: 8 },
          coordinate: { type: 'string', description: 'Alternative coordinate such as D4.' },
          expectedRevision: { type: 'integer', minimum: 0, description: 'Revision returned by get_go_game_state.' },
        },
        ['expectedRevision'],
      ),
      execute: (input) => {
        const point = parsePoint(input)
        const revision = parseRevision(input)
        if (!point) return { ok: false, error: 'invalid_coordinate' }
        return revision === null ? { ok: false, error: 'invalid_revision' } : callbacks.playMove(point, revision)
      },
    },
    {
      name: 'pass_go_turn',
      description: 'Pass the AI turn in the current Go game using the latest state revision.',
      inputSchema: toolSchema({ expectedRevision: { type: 'integer', minimum: 0 } }, ['expectedRevision']),
      execute: (input) => {
        const revision = parseRevision(input)
        return revision === null ? { ok: false, error: 'invalid_revision' } : callbacks.passTurn(revision)
      },
    },
    {
      name: 'resign_go_game',
      description: 'Resign the current Go game for the AI using the latest state revision.',
      inputSchema: toolSchema({ expectedRevision: { type: 'integer', minimum: 0 } }, ['expectedRevision']),
      execute: (input) => {
        const revision = parseRevision(input)
        return revision === null ? { ok: false, error: 'invalid_revision' } : callbacks.resignGame(revision)
      },
    },
  ]

  const controller = new AbortController()

  void (async () => {
    try {
      for (const tool of tools) {
        await registerTool(tool, { signal: controller.signal })
      }
    } catch {
      // The host can expose the API while rejecting a tool schema or permission.
      controller.abort()
      onStatus('unsupported')
    }
  })()

  return () => controller.abort()
}
