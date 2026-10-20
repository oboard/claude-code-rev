import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const previousConfigDir = process.env.CLAUDE_CONFIG_DIR
const previousKey = process.env.MINIMAX_API_KEY
const configDir = mkdtempSync(join(tmpdir(), 'minimax-request-'))
process.env.CLAUDE_CONFIG_DIR = configDir
process.env.MINIMAX_API_KEY = 'offline-placeholder'

const { ensureBootstrapMacro } = await import('../../bootstrapMacro.js')
ensureBootstrapMacro()
const { getAnthropicClient } = await import('./client.js')
const { getMainLoopModel, getSmallFastModel, getBestModel, getDefaultSonnetModel, getDefaultHaikuModel } = await import('../../utils/model/model.js')
const { getModelOptions } = await import('../../utils/model/modelOptions.js')
const { getSuggestedModelForProvider } = await import('../../utils/model/providerConfig.js')
const { setSessionSettingsCache, resetSettingsCache } = await import('../../utils/settings/settingsCache.js')
const { normalizeMiniMaxRequest } = await import('./minimaxRequest.js')
const { getGlobalConfig } = await import('../../utils/config.js')
const { modelSupportsEffort, resolveAppliedEffort } = await import('../../utils/effort.js')
const { modelSupportsThinking, modelSupportsAdaptiveThinking } = await import('../../utils/thinking.js')

const messages = [{ role: 'user', content: [
  { type: 'text', text: 'Offline fixture', cache_control: { type: 'ephemeral' } },
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'fixture' } },
] }]
const tools = [{ name: 'fixture', description: 'Offline tool', input_schema: { type: 'object', properties: {} } }]

function configure(provider: string, model?: string, providers?: Record<string, any>) {
  setSessionSettingsCache({ settings: { provider, model, providers }, errors: [] })
}

async function capture(params: Record<string, any> = {}) {
  let captured: { url: string; body: any; headers: Headers } | undefined
  const client = await getAnthropicClient({
    maxRetries: 0,
    fetchOverride: async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      captured = { url, body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) }
      return Response.json(url.includes('/chat/completions')
        ? { id: 'fixture', model: params.model, choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
        : { id: 'fixture', type: 'message', role: 'assistant', model: params.model, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } })
    },
  })
  await client.beta.messages.create({ model: getMainLoopModel(), max_tokens: 1024, messages, tools, ...params } as any)
  expect(captured).toBeDefined()
  return captured!
}

afterEach(() => resetSettingsCache())
afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  if (previousKey === undefined) delete process.env.MINIMAX_API_KEY
  else process.env.MINIMAX_API_KEY = previousKey
  rmSync(configDir, { recursive: true, force: true })
})

describe('MiniMax requests at the real client transport boundary', () => {
  for (const [provider, host] of [['minimax', 'api.minimax.io'], ['minimax-cn', 'api.minimaxi.com']]) {
    test(`${provider} defaults and helper model use Flash`, async () => {
      configure(provider!)
      expect(getMainLoopModel()).toBe('MiniMax-M3.1-Flash')
      expect(getSmallFastModel()).toBe('MiniMax-M3.1-Flash')
      expect(getBestModel()).toBe('MiniMax-M3.1-Flash')
      expect(getDefaultSonnetModel()).toBe('MiniMax-M3.1-Flash')
      expect(getDefaultHaikuModel()).toBe('MiniMax-M3.1-Flash')
      const choices = getModelOptions().map(option => option.value)
      expect(choices).toContain('MiniMax-M3.1-Flash')
      expect(choices).toContain('MiniMax-M3')
      expect(choices).not.toContain('MiniMax-M2.7')
      const request = await capture({ thinking: { type: 'enabled', budget_tokens: 512 }, service_tier: 'auto' })
      expect(new URL(request.url).hostname).toBe(host!)
      expect(new URL(request.url).pathname).toBe('/anthropic/v1/messages')
      expect(request.headers.get('authorization')).toBe('Bearer offline-placeholder')
      expect(request.body.model).toBe('MiniMax-M3.1-Flash')
      expect(request.body.thinking).toEqual({ type: 'adaptive' })
      expect(request.body.output_config).toEqual({ effort: 'max' })
      expect(request.body.service_tier).toBeUndefined()
      expect(request.body.messages).toEqual(messages)
      expect(request.body.tools).toEqual(tools)
    })
  }

  test('recognizes native thinking and effort capabilities without clamping max', () => {
    expect(modelSupportsEffort('MiniMax-M3.1-Flash')).toBe(true)
    expect(modelSupportsEffort('MiniMax-M3')).toBe(false)
    expect(resolveAppliedEffort('MiniMax-M3.1-Flash', undefined)).toBe('max')
    expect(resolveAppliedEffort('MiniMax-M3.1-Flash', 'max')).toBe('max')
    expect(resolveAppliedEffort('MiniMax-M3.1-Flash', 'low')).toBe('low')
    for (const model of ['MiniMax-M3.1-Flash', 'MiniMax-M3']) {
      expect(modelSupportsThinking(model)).toBe(true)
      expect(modelSupportsAdaptiveThinking(model)).toBe(true)
    }
  })

  test.each(['low', 'medium', 'high', 'xhigh', 'max'])('preserves Flash effort %s', async effort => {
    configure('minimax')
    const request = await capture({ thinking: { type: 'disabled' }, output_config: { effort } })
    expect(request.body.thinking).toEqual({ type: 'adaptive' })
    expect(request.body.output_config.effort).toBe(effort)
  })

  test('M3 preserves disabled thinking and ignores effort', async () => {
    configure('minimax', 'MiniMax-M3')
    const request = await capture({ thinking: { type: 'disabled' }, output_config: { effort: 'high' } })
    expect(request.body.model).toBe('MiniMax-M3')
    expect(request.body.thinking).toEqual({ type: 'disabled' })
    expect(request.body.output_config).toBeUndefined()
  })

  test('cached legacy choices are hidden while explicit custom choices remain', () => {
    const config = getGlobalConfig()
    const previous = config.additionalModelOptionsCache
    config.additionalModelOptionsCache = [
      { value: 'MiniMax-M2.7', label: 'Legacy', description: 'Cached option' },
      { value: 'other-model', label: 'Other', description: 'Cached option' },
    ]
    try {
      configure('minimax')
      expect(getModelOptions().map(option => option.value)).not.toContain('MiniMax-M2.7')
      expect(getModelOptions().map(option => option.value)).toContain('other-model')
      configure('minimax', undefined, { minimax: { models: ['MiniMax-M2.7'] } })
      expect(getModelOptions().map(option => option.value)).toContain('MiniMax-M2.7')
    } finally {
      config.additionalModelOptionsCache = previous
    }
  })

  test('saved legacy selection remains selectable and is sent unchanged', async () => {
    configure('minimax', 'MiniMax-M2.7')
    expect(getSuggestedModelForProvider('minimax', 'MiniMax-M2.7')).toBe('MiniMax-M2.7')
    expect(getModelOptions().map(option => option.value)).toContain('MiniMax-M2.7')
    const request = await capture({ thinking: { type: 'disabled' }, output_config: { effort: 'high' } })
    expect(request.body.model).toBe('MiniMax-M2.7')
    expect(request.body.thinking).toEqual({ type: 'disabled' })
    expect(request.body.output_config).toEqual({ effort: 'high' })
  })

  test('first-party requests and explicit model environment overrides are unchanged', async () => {
    configure('minimax')
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'saved-helper-override'
    try { expect(getDefaultHaikuModel()).toBe('saved-helper-override') }
    finally { delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL }
    configure('firstParty', 'claude-sonnet-4-6')
    process.env.ANTHROPIC_API_KEY = 'offline-placeholder'
    try {
      const request = await capture({ thinking: { type: 'disabled' }, output_config: { effort: 'high' }, service_tier: 'auto' })
      expect(new URL(request.url).hostname).toBe('api.anthropic.com')
      expect(request.body.model).toBe('claude-sonnet-4-6')
      expect(request.body.thinking).toEqual({ type: 'disabled' })
      expect(request.body.output_config).toEqual({ effort: 'high' })
      expect(request.body.service_tier).toBe('auto')
    } finally { delete process.env.ANTHROPIC_API_KEY }
  })

  test('saved preset overrides retain protocol, custom model and endpoint', async () => {
    configure('minimax', 'saved-custom', { minimax: { baseURL: 'https://custom.invalid/anthropic', defaultModel: 'saved-custom', models: ['saved-custom'], smallFastModel: 'saved-helper' } })
    expect(getSuggestedModelForProvider('minimax', 'saved-custom')).toBe('saved-custom')
    expect(getSmallFastModel()).toBe('saved-helper')
    const request = await capture({ thinking: { type: 'disabled' } })
    expect(request.url).toContain('https://custom.invalid/anthropic/v1/messages')
    expect(request.body.model).toBe('saved-custom')
    expect(request.body.thinking).toEqual({ type: 'disabled' })
  })

  test.each(['api.minimax.io', 'api.minimaxi.com'])('custom OpenAI route on %s preserves effort', async host => {
    configure('custom', undefined, { custom: { type: 'openai-compatible', baseURL: `https://${host}/v1`, authTokenEnv: 'MINIMAX_API_KEY', defaultModel: 'MiniMax-M3.1-Flash' } })
    const request = await capture({ output_config: { effort: 'xhigh' }, thinking: { type: 'disabled' } })
    expect(request.url).toBe(`https://${host}/v1/chat/completions`)
    expect(request.body.model).toBe('MiniMax-M3.1-Flash')
    expect(request.body.thinking).toEqual({ type: 'adaptive' })
    expect(request.body.reasoning_effort).toBe('xhigh')
    expect(request.body.messages[1].content[0].type).toBe('image_url')
    expect(request.body.tools[0].function.name).toBe('fixture')
  })

  test.each([false, true])('OpenAI reasoning survives response and tool replay (stream=%s)', async stream => {
    configure('custom', undefined, { custom: { type: 'openai-compatible', baseURL: 'https://api.minimax.io/v1', authTokenEnv: 'MINIMAX_API_KEY', defaultModel: 'MiniMax-M3.1-Flash' } })
    let sent: any
    const client = await getAnthropicClient({ maxRetries: 0, fetchOverride: async (_input, init) => {
      sent = JSON.parse(String(init?.body))
      const tool_calls = [{ index: 0, id: 'tool-1', function: { name: 'fixture', arguments: '{}' } }]
      if (sent.stream) {
        return new Response([
          { choices: [{ delta: { reasoning_content: 'Consider the tool.' } }] },
          { choices: [{ delta: { content: 'Calling tool.', tool_calls }, finish_reason: 'tool_calls' }] },
        ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
      }
      return Response.json({ id: 'fixture', choices: [{ message: { content: 'Calling tool.', reasoning_content: 'Consider the tool.', tool_calls }, finish_reason: 'tool_calls' }] })
    } })
    const response: any = await client.beta.messages.create({ model: 'MiniMax-M3.1-Flash', max_tokens: 1024, messages, stream } as any)
    let content: any[]
    if (stream) {
      const events = []
      for await (const event of response) events.push(event)
      expect(events).toContainEqual({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Consider the tool.' } })
      expect(events).toContainEqual({ type: 'content_block_stop', index: 0 })
      expect(events.some(event => event.content_block?.type === 'tool_use')).toBe(true)
      content = [{ type: 'thinking', thinking: 'Consider the tool.', signature: '' }, { type: 'tool_use', id: 'tool-1', name: 'fixture', input: {} }]
    } else {
      content = response.content
      expect(content[0]).toEqual({ type: 'thinking', thinking: 'Consider the tool.', signature: '' })
      expect(content[2].type).toBe('tool_use')
    }
    await client.beta.messages.create({ model: 'MiniMax-M3.1-Flash', max_tokens: 1024, messages: [
      { role: 'assistant', content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'result' }] },
    ] } as any)
    expect(sent.messages[0].reasoning_content).toBe('Consider the tool.')
    expect(sent.messages[0].tool_calls[0].id).toBe('tool-1')
    expect(sent.messages[1]).toEqual({ role: 'tool', tool_call_id: 'tool-1', content: 'result' })
  })

  test('does not alter unrelated endpoints, models or media requests', () => {
    for (const [url, model] of [
      ['https://gateway.invalid/anthropic/v1/messages', 'MiniMax-M3.1-Flash'],
      ['https://api.minimax.io/anthropic/v1/messages', 'custom-model'],
      ['https://api.minimax.io/anthropic/v1/messages', 'MiniMax-M2.7'],
      ['https://api.minimax.io/v1/t2a_v2', 'MiniMax-M3.1-Flash'],
    ]) {
      const init = { body: JSON.stringify({ model, thinking: { type: 'disabled' }, service_tier: 'auto', messages }) }
      expect(normalizeMiniMaxRequest(url!, init)).toBe(init)
    }
  })

  test('rejects unsupported Flash effort before the HTTP request', async () => {
    configure('minimax')
    let calls = 0
    const client = await getAnthropicClient({ maxRetries: 0, fetchOverride: async () => {
      calls++
      throw new Error('Unexpected network request')
    } })
    await expect((async () => await client.beta.messages.create({ model: 'MiniMax-M3.1-Flash', max_tokens: 1024, messages, output_config: { effort: 'none' } } as any))()).rejects.toThrow()
    expect(calls).toBe(0)
  })
})
