import type { ClientOptions } from '@anthropic-ai/sdk'
import { isDirectMiniMaxTextRequest } from './minimaxRequest.js'
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk/error'

type OpenAICompatibleProviderType =
  | 'openai-compatible'
  | 'github-models'
  | 'github-copilot'

type OpenAICompatibleClientOptions = {
  providerType: OpenAICompatibleProviderType
  baseURL?: string
  authToken?: string
  defaultHeaders?: Record<string, string>
  timeout?: number
  fetch?: ClientOptions['fetch']
  fetchOptions?: ClientOptions['fetchOptions']
}

type RequestOptions = {
  headers?: Record<string, string>
  signal?: AbortSignal
  timeout?: number
}

type OpenAIChatCompletionChunk = {
  id?: string
  model?: string
  choices?: Array<{
    delta?: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

type OpenAIChatCompletionResponse = {
  id?: string
  model?: string
  choices?: Array<{
    message?: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        id?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

type ResponseEnvelope<T> = {
  data: T
  request_id: string | null
  response: Response
}

type PromiseWithResponse<T> = Promise<T> & {
  asResponse: () => Promise<Response>
  withResponse: () => Promise<ResponseEnvelope<T>>
}

type OpenBlock =
  | {
      kind: 'text' | 'thinking'
      index: number
      closed: boolean
    }
  | {
      kind: 'tool_use'
      index: number
      sourceIndex: number
      id: string
      name: string
      closed: boolean
    }

function getDefaultBaseUrl(providerType: OpenAICompatibleProviderType): string {
  if (providerType === 'github-models') {
    return 'https://models.github.ai/inference'
  }
  if (providerType === 'github-copilot') {
    return 'https://api.githubcopilot.com'
  }
  return 'https://api.openai.com/v1'
}

function joinUrl(baseUrl: string, path: string): string {
  const url = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  url.pathname = `${url.pathname.replace(/\/?$/, '/')}${path}`.replace(
    /\/+/g,
    '/',
  )
  return url.toString()
}

function getRequestId(headers: Headers): null | string {
  return (
    headers.get('x-request-id') ||
    headers.get('request-id') ||
    headers.get('x-github-request-id') ||
    null
  )
}

function toAnthropicUsage(usage?: {
  prompt_tokens?: number
  completion_tokens?: number
}): {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
} {
  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
}

function mapFinishReason(finishReason: null | string | undefined): null | string {
  switch (finishReason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'refusal'
    case 'stop':
      return 'end_turn'
    default:
      return null
  }
}

function parseJsonObject(value: string | undefined): unknown {
  if (!value) return {}
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function flattenToolResultContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return JSON.stringify(content ?? '')
  }
  return content
    .map(block => {
      if (typeof block === 'string') return block
      if (!block || typeof block !== 'object') return JSON.stringify(block)
      if ('text' in block && typeof block.text === 'string') return block.text
      if ('type' in block && block.type === 'image') {
        return '[image omitted]'
      }
      if ('type' in block && block.type === 'document') {
        return '[document omitted]'
      }
      return JSON.stringify(block)
    })
    .join('\n')
}

function flattenSystemPrompt(system: unknown): string | undefined {
  if (!Array.isArray(system)) {
    return typeof system === 'string' && system.length > 0 ? system : undefined
  }
  const text = system
    .map(block => {
      if (!block || typeof block !== 'object') return ''
      return 'text' in block && typeof block.text === 'string' ? block.text : ''
    })
    .filter(Boolean)
    .join('\n\n')
  return text.length > 0 ? text : undefined
}

function anthropicMessagesToOpenAI(
  system: unknown,
  messages: unknown,
  preserveReasoning = false,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const systemPrompt = flattenSystemPrompt(system)
  if (systemPrompt) {
    out.push({ role: 'system', content: systemPrompt })
  }

  if (!Array.isArray(messages)) {
    return out
  }

  for (const rawMessage of messages) {
    if (!rawMessage || typeof rawMessage !== 'object') continue
    const message = rawMessage as Record<string, unknown>
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    const content = message.content

    if (typeof content === 'string') {
      out.push({ role, content })
      continue
    }

    if (!Array.isArray(content)) {
      out.push({ role, content: JSON.stringify(content ?? '') })
      continue
    }

    if (role === 'assistant') {
      const textParts: string[] = []
      const toolCalls: Array<Record<string, unknown>> = []
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const typedBlock = block as Record<string, unknown>
        if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
          textParts.push(typedBlock.text)
          continue
        }
        if (typedBlock.type === 'tool_use') {
          toolCalls.push({
            id:
              typeof typedBlock.id === 'string'
                ? typedBlock.id
                : `toolu_${Math.random().toString(36).slice(2, 10)}`,
            type: 'function',
            function: {
              name: String(typedBlock.name ?? ''),
              arguments:
                typeof typedBlock.input === 'string'
                  ? typedBlock.input
                  : JSON.stringify(typedBlock.input ?? {}),
            },
          })
        }
      }
      if (textParts.length > 0 || toolCalls.length > 0) {
        out.push({
          role: 'assistant',
          content: textParts.length > 0 ? textParts.join('\n') : null,
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
          ...(preserveReasoning ? { reasoning_content: content
            .filter(block => block?.type === 'thinking')
            .map(block => block.thinking ?? '').join('') } : {}),
        })
      }
      continue
    }

    let pendingUserText: string[] = []
    const flushPendingUserText = () => {
      if (pendingUserText.length === 0) return
      out.push({ role: 'user', content: pendingUserText.join('\n') })
      pendingUserText = []
    }

    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const typedBlock = block as Record<string, unknown>
      switch (typedBlock.type) {
        case 'text':
          if (typeof typedBlock.text === 'string') {
            pendingUserText.push(typedBlock.text)
          }
          break
        case 'tool_result':
          flushPendingUserText()
          out.push({
            role: 'tool',
            tool_call_id: String(typedBlock.tool_use_id ?? ''),
            content: flattenToolResultContent(typedBlock.content),
          })
          break
        case 'image': {
          const source =
            typedBlock.source && typeof typedBlock.source === 'object'
              ? (typedBlock.source as Record<string, unknown>)
              : null
          if (
            source?.type === 'base64' &&
            typeof source.data === 'string' &&
            typeof source.media_type === 'string'
          ) {
            flushPendingUserText()
            out.push({
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${source.media_type};base64,${source.data}`,
                  },
                },
              ],
            })
          } else {
            pendingUserText.push('[image omitted]')
          }
          break
        }
        case 'document':
          pendingUserText.push('[document omitted]')
          break
        default:
          pendingUserText.push(JSON.stringify(typedBlock))
          break
      }
    }
    flushPendingUserText()
  }

  return out
}

function anthropicToolsToOpenAI(tools: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(tools)) return undefined
  const mapped = tools
    .flatMap(tool => {
      if (!tool || typeof tool !== 'object') return []
      const typedTool = tool as Record<string, unknown>
      if (
        typeof typedTool.name !== 'string' ||
        typeof typedTool.description !== 'string' ||
        !typedTool.input_schema
      ) {
        return []
      }
      return [
        {
          type: 'function',
          function: {
            name: typedTool.name,
            description: typedTool.description,
            parameters: typedTool.input_schema,
            ...(typedTool.strict === true && { strict: true }),
          },
        },
      ]
    })
  return mapped.length > 0 ? mapped : undefined
}

function anthropicToolChoiceToOpenAI(toolChoice: unknown): unknown {
  if (!toolChoice || typeof toolChoice !== 'object') return undefined
  const typedToolChoice = toolChoice as Record<string, unknown>
  if (typedToolChoice.type === 'auto') return 'auto'
  if (typedToolChoice.type === 'tool' && typeof typedToolChoice.name === 'string') {
    return {
      type: 'function',
      function: { name: typedToolChoice.name },
    }
  }
  return undefined
}

function openAIMessageToAnthropicContent(message: {
  content?: null | string
  reasoning_content?: null | string
  tool_calls?: Array<{
    id?: string
    function?: {
      name?: string
      arguments?: string
    }
  }>
}, preserveReasoning = false): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = []
  if (preserveReasoning && message.reasoning_content) {
    content.push({ type: 'thinking', thinking: message.reasoning_content, signature: '' })
  }
  if (typeof message.content === 'string' && message.content.length > 0) {
    content.push({ type: 'text', text: message.content })
  }
  for (const toolCall of message.tool_calls ?? []) {
    content.push({
      type: 'tool_use',
      id:
        typeof toolCall.id === 'string'
          ? toolCall.id
          : `toolu_${Math.random().toString(36).slice(2, 10)}`,
      name: toolCall.function?.name ?? '',
      input: parseJsonObject(toolCall.function?.arguments),
    })
  }
  if (content.length === 0) {
    content.push({ type: 'text', text: '' })
  }
  return content
}

function openAIResponseToAnthropicMessage(
  response: OpenAIChatCompletionResponse,
  model: string,
  requestId: null | string,
  preserveReasoning = false,
) {
  const choice = response.choices?.[0]
  const message = choice?.message ?? {}
  const hasToolCalls = (message.tool_calls?.length ?? 0) > 0
  const mappedStopReason = mapFinishReason(choice?.finish_reason)
  const anthropicMessage = {
    id: response.id ?? `msg_${Math.random().toString(36).slice(2, 10)}`,
    type: 'message',
    role: 'assistant',
    model: response.model ?? model,
    content: openAIMessageToAnthropicContent(message, preserveReasoning),
    stop_reason:
      hasToolCalls && (mappedStopReason === null || mappedStopReason === 'end_turn')
        ? 'tool_use'
        : mappedStopReason,
    stop_sequence: null,
    usage: toAnthropicUsage(response.usage),
    _request_id: requestId ?? undefined,
  }
  return anthropicMessage
}

function parseJsonOrText(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

async function* parseServerSentEvents(response: Response) {
  const body = response.body
  if (!body) {
    throw new APIConnectionError({ message: 'Missing streaming response body.' })
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    while (true) {
      const separatorIndex = buffer.indexOf('\n\n')
      if (separatorIndex === -1) break
      const rawEvent = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)
      const data = rawEvent
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
      if (!data) continue
      if (data === '[DONE]') return
      yield JSON.parse(data) as OpenAIChatCompletionChunk
    }
  }
  const trailing = buffer.trim()
  if (!trailing) return
  const trailingData = trailing
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')
  if (trailingData && trailingData !== '[DONE]') {
    yield JSON.parse(trailingData) as OpenAIChatCompletionChunk
  }
}

function createOpenAIEventStream(
  response: Response,
  model: string,
  preserveReasoning = false,
): AsyncIterable<unknown> & { controller: AbortController } {
  const controller = new AbortController()

  const iterable = (async function* () {
    const requestId = getRequestId(response.headers)
    const usage = toAnthropicUsage()
    const openBlocks: OpenBlock[] = []
    let nextIndex = 0
    let emittedMessageStart = false
    let responseId: string | undefined
    let responseModel: string | undefined
    let finishReason: null | string | undefined = null
    let sawToolUse = false

    const ensureMessageStart = () => {
      if (emittedMessageStart) return
      emittedMessageStart = true
      return {
        type: 'message_start',
        message: {
          id: responseId ?? `msg_${Math.random().toString(36).slice(2, 10)}`,
          type: 'message',
          role: 'assistant',
          model: responseModel ?? model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage,
        },
      }
    }

    const getTextBlock = () => {
      const existing = openBlocks.find(block => block.kind === 'text')
      if (existing) return existing
      const created: OpenBlock = {
        kind: 'text',
        index: nextIndex++,
        closed: false,
      }
      openBlocks.push(created)
      return created
    }

    const getToolBlock = (toolIndex: number, id?: string, name?: string) => {
      const existing = openBlocks.find(
        block => block.kind === 'tool_use' && block.sourceIndex === toolIndex,
      )
      if (existing && existing.kind === 'tool_use') {
        if (name) existing.name = name
        if (id) existing.id = id
        return existing
      }
      const created: OpenBlock = {
        kind: 'tool_use',
        index: nextIndex++,
        sourceIndex: toolIndex,
        id: id ?? `toolu_${Math.random().toString(36).slice(2, 10)}`,
        name: name ?? '',
        closed: false,
      }
      openBlocks.push(created)
      return created
    }

    const closeOpenBlocks = function* () {
      for (const block of [...openBlocks].sort((a, b) => a.index - b.index)) {
        if (block.closed) continue
        block.closed = true
        yield {
          type: 'content_block_stop',
          index: block.index,
        }
      }
    }

    for await (const chunk of parseServerSentEvents(response)) {
      if (!responseId && chunk.id) {
        responseId = chunk.id
      }
      if (!responseModel && chunk.model) {
        responseModel = chunk.model
      }
      if (chunk.usage) {
        usage.input_tokens = chunk.usage.prompt_tokens ?? usage.input_tokens
        usage.output_tokens =
          chunk.usage.completion_tokens ?? usage.output_tokens
      }
      const startEvent = ensureMessageStart()
      if (startEvent) {
        yield startEvent
      }

      const choice = chunk.choices?.[0]
      if (!choice) continue
      const delta = choice.delta ?? {}
      finishReason = choice.finish_reason ?? finishReason

      if (preserveReasoning && delta.reasoning_content) {
        let block = openBlocks.find(block => block.kind === 'thinking' && !block.closed)
        if (!block) {
          block = { kind: 'thinking', index: nextIndex++, closed: false }
          openBlocks.push(block)
          yield { type: 'content_block_start', index: block.index,
            content_block: { type: 'thinking', thinking: '', signature: '' } }
        }
        yield { type: 'content_block_delta', index: block.index,
          delta: { type: 'thinking_delta', thinking: delta.reasoning_content } }
      }
      if (preserveReasoning && (delta.content || delta.tool_calls?.length)) {
        const block = openBlocks.find(block => block.kind === 'thinking' && !block.closed)
        if (block) {
          block.closed = true
          yield { type: 'content_block_stop', index: block.index }
        }
      }

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        const block = getTextBlock()
        if (!block.closed && !('started' in (block as Record<string, unknown>))) {
          ;(block as Record<string, unknown>).started = true
          yield {
            type: 'content_block_start',
            index: block.index,
            content_block: {
              type: 'text',
              text: '',
            },
          }
        }
        yield {
          type: 'content_block_delta',
          index: block.index,
          delta: {
            type: 'text_delta',
            text: delta.content,
          },
        }
      }

      for (const toolCall of delta.tool_calls ?? []) {
        sawToolUse = true
        const toolIndex =
          typeof toolCall.index === 'number' ? toolCall.index : nextIndex
        const block = getToolBlock(
          toolIndex,
          toolCall.id,
          toolCall.function?.name,
        )
        if (
          !block.closed &&
          !('started' in (block as Record<string, unknown>)) &&
          block.name.length > 0
        ) {
          ;(block as Record<string, unknown>).started = true
          yield {
            type: 'content_block_start',
            index: block.index,
            content_block: {
              type: 'tool_use',
              id: block.id,
              name: block.name,
              input: '',
            },
          }
        }
        if (
          typeof toolCall.function?.arguments === 'string' &&
          toolCall.function.arguments.length > 0
        ) {
          if (!('started' in (block as Record<string, unknown>))) {
            ;(block as Record<string, unknown>).started = true
            yield {
              type: 'content_block_start',
              index: block.index,
              content_block: {
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: '',
              },
            }
          }
          yield {
            type: 'content_block_delta',
            index: block.index,
            delta: {
              type: 'input_json_delta',
              partial_json: toolCall.function.arguments,
            },
          }
        }
      }

      if (finishReason) {
        yield* closeOpenBlocks()
      }
    }

    if (!emittedMessageStart) {
      yield {
        type: 'message_start',
        message: {
          id: `msg_${Math.random().toString(36).slice(2, 10)}`,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage,
        },
      }
    }

    yield* closeOpenBlocks()
    const mappedStopReason = mapFinishReason(finishReason)
    yield {
      type: 'message_delta',
      delta: {
        stop_reason:
          sawToolUse && (mappedStopReason === null || mappedStopReason === 'end_turn')
            ? 'tool_use'
            : mappedStopReason,
      },
      usage,
    }
    yield { type: 'message_stop' }
  })()

  return Object.assign(iterable, { controller })
}

async function requestJson(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchFn(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw new APIUserAbortError()
    }
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new APIConnectionTimeoutError({ message: error.message })
    }
    throw new APIConnectionError({
      message: error instanceof Error ? error.message : 'Connection error.',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

function buildHeaders(
  providerType: OpenAICompatibleProviderType,
  authToken: string | undefined,
  defaultHeaders: Record<string, string>,
  extraHeaders?: Record<string, string>,
): Headers {
  const headers = new Headers({
    ...defaultHeaders,
    'content-type': 'application/json',
    ...(providerType === 'github-models'
      ? {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        }
      : providerType === 'github-copilot'
        ? {
            Accept: 'application/json',
            'Editor-Version': `claude-code/${MACRO.VERSION}`,
            'Editor-Plugin-Version': `claude-code/${MACRO.VERSION}`,
          }
      : {}),
    ...(extraHeaders ?? {}),
  })
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`)
  }
  return headers
}

function buildSignal(
  signal: AbortSignal | undefined,
  timeout: number | undefined,
): AbortSignal | undefined {
  if (!signal && !timeout) return undefined
  if (signal && timeout && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([signal, AbortSignal.timeout(timeout)])
  }
  if (!signal && timeout) {
    return AbortSignal.timeout(timeout)
  }
  return signal
}

function createPromiseWithResponse<T>(
  promise: Promise<ResponseEnvelope<T>>,
): PromiseWithResponse<T> {
  const typed = promise.then(result => result.data) as PromiseWithResponse<T>
  typed.asResponse = async () => (await promise).response
  typed.withResponse = async () => promise
  return typed
}

export function createOpenAICompatibleClient(
  options: OpenAICompatibleClientOptions,
) {
  const providerType = options.providerType
  const baseURL = options.baseURL ?? getDefaultBaseUrl(providerType)
  const fetchFn = (options.fetch ?? globalThis.fetch).bind(globalThis)
  const defaultHeaders = options.defaultHeaders ?? {}

  const create = (
    params: Record<string, unknown>,
    requestOptions: RequestOptions = {},
  ) => {
    const promise = (async (): Promise<ResponseEnvelope<unknown>> => {
      const url = joinUrl(baseURL, 'chat/completions')
      const isMiniMax = isDirectMiniMaxTextRequest(new URL(url), params.model)
      const body = {
        model: params.model,
        messages: anthropicMessagesToOpenAI(params.system, params.messages, isMiniMax),
        tools: anthropicToolsToOpenAI(params.tools),
        tool_choice: anthropicToolChoiceToOpenAI(params.tool_choice),
        stream: params.stream === true,
        max_tokens: params.max_tokens,
        ...(isMiniMax
          ? {
              thinking: params.thinking,
              reasoning_effort: (params.output_config as { effort?: unknown } | undefined)?.effort,
            }
          : {}),
        ...(typeof params.temperature === 'number'
          ? { temperature: params.temperature }
          : {}),
        ...(Array.isArray(params.stop_sequences)
          ? { stop: params.stop_sequences }
          : {}),
        ...(params.stream === true ? { stream_options: { include_usage: true } } : {}),
      }

      const response = await requestJson(fetchFn, url, {
        method: 'POST',
        headers: buildHeaders(
          providerType,
          options.authToken,
          defaultHeaders,
          requestOptions.headers,
        ),
        body: JSON.stringify(body),
        signal: buildSignal(requestOptions.signal, requestOptions.timeout ?? options.timeout),
        ...(options.fetchOptions as RequestInit | undefined),
      })

      const requestId = getRequestId(response.headers)
      if (!response.ok) {
        const rawBody = await response.text()
        throw APIError.generate(
          response.status,
          parseJsonOrText(rawBody) as Record<string, unknown> | undefined,
          undefined,
          response.headers,
        )
      }

      if (params.stream === true) {
        return {
          data: createOpenAIEventStream(response, String(params.model ?? ''), isMiniMax),
          request_id: requestId,
          response,
        }
      }

      const json = (await response.json()) as OpenAIChatCompletionResponse
      return {
        data: openAIResponseToAnthropicMessage(
          json,
          String(params.model ?? ''),
          requestId,
          isMiniMax,
        ),
        request_id: requestId,
        response,
      }
    })()

    return createPromiseWithResponse(promise)
  }

  return {
    beta: {
      messages: {
        create,
      },
    },
    models: {
      async *list() {
        return
      },
    },
  }
}
