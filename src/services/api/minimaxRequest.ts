const FLASH_MODEL = 'MiniMax-M3.1-Flash'
const FLASH_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

export function isDirectMiniMaxTextRequest(url: URL, model: unknown): boolean {
  return url.protocol === 'https:' &&
    ['api.minimax.io', 'api.minimaxi.com'].includes(url.host) &&
    ['/anthropic/v1/messages', '/v1/chat/completions'].includes(url.pathname) &&
    (model === FLASH_MODEL || model === 'MiniMax-M3')
}

// Scope compatibility to the direct API, never to arbitrary gateways or legacy models.
export function normalizeMiniMaxRequest(
  input: string | URL | Request,
  init: RequestInit | undefined,
): RequestInit | undefined {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (
    url.protocol !== 'https:' ||
    !['api.minimax.io', 'api.minimaxi.com'].includes(url.host) ||
    !['/anthropic/v1/messages', '/v1/chat/completions'].includes(url.pathname) ||
    typeof init?.body !== 'string'
  ) {
    return init
  }

  const body = JSON.parse(init.body)
  if (!isDirectMiniMaxTextRequest(url, body.model)) return init

  const isFlash = body.model === FLASH_MODEL
  if (isFlash || body.thinking?.type === 'enabled') {
    body.thinking = { type: 'adaptive' }
  }

  if (url.pathname === '/anthropic/v1/messages') {
    const outputConfig = { ...body.output_config }
    if (isFlash) {
      const effort = outputConfig.effort ?? 'max'
      if (!FLASH_EFFORTS.has(effort)) {
        throw new Error('MiniMax-M3.1-Flash effort must be low, medium, high, xhigh, or max')
      }
      outputConfig.effort = effort
    } else {
      delete outputConfig.effort
    }
    if (Object.keys(outputConfig).length) body.output_config = outputConfig
    else delete body.output_config
  } else if (isFlash) {
    const effort = body.reasoning_effort ?? 'max'
    if (!FLASH_EFFORTS.has(effort)) {
      throw new Error('MiniMax-M3.1-Flash effort must be low, medium, high, xhigh, or max')
    }
    body.reasoning_effort = effort
  } else {
    delete body.reasoning_effort
  }

  if (isFlash) {
    delete body.service_tier
    if (body.reasoning_split === false) delete body.reasoning_split
  }
  return { ...init, body: JSON.stringify(body) }
}
