import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Point } from './go.js'
import { registerWebMCPTools, type WebMCPCallbacks } from './webmcp.js'

type RegisteredTool = {
  execute: (input: unknown) => unknown | Promise<unknown>
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'document')
})

describe('WebMCP tool registration', () => {
  it('requires and normalizes the AI model ID before joining', async () => {
    const tools = new Map<string, RegisteredTool>()
    const signals: AbortSignal[] = []
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        modelContext: {
          async registerTool(tool: { name: string } & RegisteredTool, options?: { signal?: AbortSignal }) {
            tools.set(tool.name, tool)
            if (options?.signal) signals.push(options.signal)
          },
        },
      },
    })

    const joinMatch = vi.fn(() => ({ ok: true }))
    const callbacks: WebMCPCallbacks = {
      joinMatch,
      getGameState: () => ({ ok: true }),
      playMove: (_point: Point, _expectedRevision: number) => ({ ok: true }),
      passTurn: (_expectedRevision: number) => ({ ok: true }),
      resignGame: (_expectedRevision: number) => ({ ok: true }),
    }
    const onStatus = vi.fn()
    const dispose = registerWebMCPTools(callbacks, onStatus)

    await vi.waitFor(() => expect(tools.size).toBe(5))
    await expect(tools.get('join_go_match')?.execute({})).resolves.toEqual({ ok: false, error: 'model_id_required' })
    expect(joinMatch).not.toHaveBeenCalled()

    await tools.get('join_go_match')?.execute({ modelId: '  openai/gpt-5  ', displayName: '  Go Agent  ' })
    expect(joinMatch).toHaveBeenCalledWith({ modelId: 'openai/gpt-5', displayName: 'Go Agent' })
    expect(onStatus).toHaveBeenCalledWith('available')

    dispose()
    expect(signals).toHaveLength(5)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })
})
