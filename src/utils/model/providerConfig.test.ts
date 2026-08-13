import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const previousConfigDir = process.env.CLAUDE_CONFIG_DIR
const configDir = mkdtempSync(join(tmpdir(), 'provider-config-'))
process.env.CLAUDE_CONFIG_DIR = configDir

const {
  getAllProviderConfigs,
  getProviderConfigById,
  getSuggestedModelForProvider,
} = await import('./providerConfig.js')

afterAll(() => {
  if (previousConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  }
  rmSync(configDir, { recursive: true, force: true })
})

describe('MiniMax provider presets', () => {
  test.each([
    ['minimax', 'MiniMax', 'https://api.minimax.io/anthropic'],
    ['minimax-cn', 'MiniMax (China)', 'https://api.minimaxi.com/anthropic'],
  ])('resolves %s', (id, name, baseURL) => {
    expect(getProviderConfigById(id)).toMatchObject({
      id,
      type: 'anthropic-compatible',
      name,
      baseURL,
      authTokenEnv: 'MINIMAX_API_KEY',
      defaultModel: 'MiniMax-M3',
      models: ['MiniMax-M3', 'MiniMax-M2.7'],
      isCustom: false,
    })
  })

  test('lists both regional presets and selects the default model', () => {
    const providerIds = getAllProviderConfigs().map(provider => provider.id)

    expect(providerIds).toContain('minimax')
    expect(providerIds).toContain('minimax-cn')
    expect(getSuggestedModelForProvider('minimax', null)).toBe('MiniMax-M3')
  })
})
