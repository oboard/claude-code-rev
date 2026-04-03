import * as React from 'react'
import { useState } from 'react'
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js'
import { Box, Text } from '../ink.js'
import { useAppState, useSetAppState } from '../state/AppState.js'
import type { ModelSetting } from '../utils/model/model.js'
import { modelDisplayString } from '../utils/model/model.js'
import {
  getActiveProviderConfig,
  getAllProviderConfigs,
  getEnvironmentProviderOverrideId,
  getProviderConfigById,
  getStoredProviderId,
  getSuggestedModelForProvider,
  normalizeProviderSettingValue,
  type ResolvedProviderConfig,
} from '../utils/model/providerConfig.js'
import {
  isFastModeEnabled,
  isFastModeSupportedByModel,
} from '../utils/fastMode.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'
import { ModelPicker } from './ModelPicker.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'

export type ProviderPickerProps = {
  initial?: string
  onSelect: (providerId: string) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
  headerText?: string
}

export type ProviderSelectionResult = {
  providerId: string
  providerName: string
  model: string | null
  changed: boolean
  savedOnly: boolean
  wasFastModeDisabled: boolean
  envOverrideId?: string
  envOverrideName?: string
}

type ProviderSelectionFlowProps = {
  onComplete: (result: ProviderSelectionResult) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
}

function getProviderDescription(provider: ResolvedProviderConfig): string {
  switch (provider.type) {
    case 'firstParty':
      return 'Anthropic direct API and Claude account auth'
    case 'github-models':
      return 'GitHub Models via gh auth token or GITHUB_TOKEN'
    case 'github-copilot':
      return 'GitHub Copilot account-backed Claude models'
    case 'bedrock':
      return 'Amazon Bedrock credentials from your AWS environment'
    case 'vertex':
      return 'Google Vertex AI project and credentials'
    case 'foundry':
      return 'Azure AI Foundry resource and credentials'
    case 'anthropic-compatible':
      return provider.baseURL
        ? `Custom Anthropic-compatible provider · ${provider.baseURL}`
        : 'Custom Anthropic-compatible provider'
    case 'openai-compatible':
      return provider.baseURL
        ? `Custom OpenAI-compatible provider · ${provider.baseURL}`
        : 'Custom OpenAI-compatible provider'
  }
}

export function ProviderPicker({
  initial,
  onSelect,
  onCancel,
  isStandaloneCommand,
  headerText,
}: ProviderPickerProps) {
  const exitState = useExitOnCtrlCDWithKeybindings()
  const providerOptions = getAllProviderConfigs().map(provider => ({
    label: provider.name,
    value: provider.id,
    description: getProviderDescription(provider),
  }))
  const envOverrideId = getEnvironmentProviderOverrideId()
  const envOverrideName = envOverrideId
    ? getProviderConfigById(envOverrideId).name
    : undefined
  const initialValue =
    initial && providerOptions.some(option => option.value === initial)
      ? initial
      : getActiveProviderConfig().id
  const visibleCount = Math.min(8, providerOptions.length)

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Text color="remember" bold>
          Select provider
        </Text>
        <Text dimColor>
          {headerText ??
            'Choose the model provider for Claude Code. When the change can take effect immediately, model selection opens next.'}
        </Text>
        {envOverrideName ? (
          <Text dimColor>
            Current session is forced to {envOverrideName} by environment
            variables. Picking another provider saves a preference for future
            sessions.
          </Text>
        ) : null}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Select
          options={providerOptions}
          onChange={onSelect}
          onCancel={onCancel}
          defaultValue={initialValue}
          defaultFocusValue={initialValue}
          visibleOptionCount={visibleCount}
          layout="compact-vertical"
        />
      </Box>

      {isStandaloneCommand ? (
        <Text dimColor italic>
          {exitState.pending ? (
            <>Press {exitState.keyName} again to exit</>
          ) : (
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint
                action="select:cancel"
                context="Select"
                fallback="Esc"
                description="exit"
              />
            </Byline>
          )}
        </Text>
      ) : null}
    </Box>
  )
}

export function ProviderSelectionFlow({
  onComplete,
  onCancel,
  isStandaloneCommand,
}: ProviderSelectionFlowProps) {
  const mainLoopModel = useAppState(state => state.mainLoopModel)
  const mainLoopModelForSession = useAppState(
    state => state.mainLoopModelForSession,
  )
  const fastMode = useAppState(state => state.fastMode)
  const setAppState = useSetAppState()
  const [initialStoredProviderId] = useState(() => getStoredProviderId() ?? 'firstParty')
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null)
  const [pendingModel, setPendingModel] = useState<ModelSetting>(null)

  const envOverrideId = getEnvironmentProviderOverrideId()

  const finishSelection = React.useCallback(
    (providerId: string, model: string | null, savedOnly: boolean) => {
      const providerName = getProviderConfigById(providerId).name
      const providerChanged =
        normalizeProviderSettingValue(initialStoredProviderId) !==
        normalizeProviderSettingValue(providerId)
      const modelChanged =
        !savedOnly &&
        (mainLoopModel !== model || mainLoopModelForSession !== null)

      let wasFastModeDisabled = false
      if (!savedOnly) {
        setAppState(prev => {
          wasFastModeDisabled =
            isFastModeEnabled() &&
            !isFastModeSupportedByModel(model) &&
            !!prev.fastMode

          return {
            ...prev,
            mainLoopModel: model,
            mainLoopModelForSession: null,
            ...(wasFastModeDisabled ? { fastMode: false } : {}),
          }
        })
      }

      onComplete({
        providerId,
        providerName,
        model,
        changed: providerChanged || modelChanged,
        savedOnly,
        wasFastModeDisabled,
        ...(envOverrideId
          ? {
              envOverrideId,
              envOverrideName: getProviderConfigById(envOverrideId).name,
            }
          : {}),
      })
    },
    [
      envOverrideId,
      initialStoredProviderId,
      mainLoopModel,
      mainLoopModelForSession,
      onComplete,
      setAppState,
    ],
  )

  const handleProviderSelect = React.useCallback(
    (providerId: string) => {
      updateSettingsForSource('userSettings', {
        provider: normalizeProviderSettingValue(providerId),
      })

      if (envOverrideId && envOverrideId !== providerId) {
        finishSelection(providerId, mainLoopModel, true)
        return
      }

      setPendingProviderId(providerId)
      setPendingModel(getSuggestedModelForProvider(providerId, mainLoopModel))
    },
    [envOverrideId, finishSelection, mainLoopModel],
  )

  const handleModelSelect = React.useCallback(
    (model: string | null, _effort?: unknown) => {
      if (!pendingProviderId) {
        return
      }

      finishSelection(pendingProviderId, model, false)
    },
    [finishSelection, pendingProviderId],
  )

  const handleModelCancel = React.useCallback(() => {
    if (!pendingProviderId) {
      return
    }

    finishSelection(pendingProviderId, pendingModel ?? null, false)
  }, [finishSelection, pendingModel, pendingProviderId])

  if (pendingProviderId) {
    return (
      <ModelPicker
        initial={pendingModel}
        sessionModel={mainLoopModelForSession}
        onSelect={handleModelSelect}
        onCancel={handleModelCancel}
        isStandaloneCommand={isStandaloneCommand}
        headerText={`Choose a model for ${getProviderConfigById(pendingProviderId).name}. Applies to this session and future Claude Code sessions.`}
        showFastModeNotice={
          isFastModeEnabled() &&
          !!fastMode &&
          isFastModeSupportedByModel(pendingModel) &&
          (!envOverrideId || envOverrideId === pendingProviderId)
        }
      />
    )
  }

  return (
    <ProviderPicker
      initial={getActiveProviderConfig().id}
      onSelect={handleProviderSelect}
      onCancel={onCancel}
      isStandaloneCommand={isStandaloneCommand}
    />
  )
}

export function getProviderSelectionSummary(
  result: ProviderSelectionResult,
): string {
  if (result.savedOnly && result.envOverrideName) {
    return `Saved provider preference as ${result.providerName}. Current session still uses ${result.envOverrideName} because environment variables override provider selection.`
  }

  let summary = `Set provider to ${result.providerName}`

  if (result.model !== undefined) {
    summary += ` · Model set to ${modelDisplayString(result.model)}`
  }

  if (result.wasFastModeDisabled) {
    summary += ' · Fast mode OFF'
  }

  return summary
}
