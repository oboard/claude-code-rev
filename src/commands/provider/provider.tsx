import chalk from 'chalk'
import * as React from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import {
  getProviderSelectionSummary,
  ProviderSelectionFlow,
  type ProviderSelectionResult,
} from '../../components/ProviderPicker.js'
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  isFastModeEnabled,
  isFastModeSupportedByModel,
} from '../../utils/fastMode.js'
import {
  getActiveProviderConfig,
  getAllProviderConfigs,
  getEnvironmentProviderOverrideId,
  getProviderConfigById,
  getStoredProviderId,
  getSuggestedModelForProvider,
  normalizeProviderSettingValue,
} from '../../utils/model/providerConfig.js'
import { modelDisplayString } from '../../utils/model/model.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'

function ProviderPickerWrapper({
  onDone,
}: {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}) {
  const currentProviderName = getActiveProviderConfig().name

  const handleComplete = React.useCallback(
    (result: ProviderSelectionResult) => {
      if (!result.changed) {
        onDone(`Kept provider as ${chalk.bold(currentProviderName)}`, {
          display: 'system',
        })
        return
      }

      onDone(getProviderSelectionSummary(result))
    },
    [currentProviderName, onDone],
  )

  const handleCancel = React.useCallback(() => {
    onDone(`Kept provider as ${chalk.bold(currentProviderName)}`, {
      display: 'system',
    })
  }, [currentProviderName, onDone])

  return (
    <ProviderSelectionFlow
      onComplete={handleComplete}
      onCancel={handleCancel}
      isStandaloneCommand
    />
  )
}

function ShowProviderAndClose({
  onDone,
}: {
  onDone: (result?: string) => void
}) {
  const activeProvider = getActiveProviderConfig()
  const storedProviderId = getStoredProviderId() ?? 'firstParty'
  const envOverrideId = getEnvironmentProviderOverrideId()
  let message = `Current provider: ${chalk.bold(activeProvider.name)}`

  if (activeProvider.baseURL) {
    message += `\nBase URL: ${activeProvider.baseURL}`
  }

  if (envOverrideId) {
    message += `\nSaved preference: ${getProviderConfigById(storedProviderId).name}`
    message += `\nEnvironment override: ${getProviderConfigById(envOverrideId).name}`
  }

  onDone(message)
  return null
}

function resolveProviderArg(input: string) {
  const normalized = input.trim().toLowerCase()
  const alias =
    {
      anthropic: 'firstParty',
      default: 'firstParty',
      firstparty: 'firstParty',
      'first-party': 'firstParty',
      copilot: 'github-copilot',
      'github-copilot': 'github-copilot',
      'github-models': 'github-models',
      models: 'github-models',
    }[normalized] ?? normalized

  return getAllProviderConfigs().find(
    provider =>
      provider.id.toLowerCase() === alias ||
      provider.name.toLowerCase() === normalized,
  )
}

function SetProviderAndClose({
  args,
  onDone,
}: {
  args: string
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}) {
  const mainLoopModel = useAppState(state => state.mainLoopModel)
  const mainLoopModelForSession = useAppState(
    state => state.mainLoopModelForSession,
  )
  const setAppState = useSetAppState()

  React.useEffect(() => {
    const provider = resolveProviderArg(args)

    if (!provider) {
      const availableProviders = getAllProviderConfigs()
        .map(option => option.id)
        .join(', ')
      onDone(
        `Unknown provider '${args}'. Available providers: ${availableProviders}`,
        {
          display: 'system',
        },
      )
      return
    }

    const previousStoredProviderId = getStoredProviderId() ?? 'firstParty'
    const envOverrideId = getEnvironmentProviderOverrideId()

    updateSettingsForSource('userSettings', {
      provider: normalizeProviderSettingValue(provider.id),
    })

    if (envOverrideId && envOverrideId !== provider.id) {
      const changed =
        normalizeProviderSettingValue(previousStoredProviderId) !==
        normalizeProviderSettingValue(provider.id)

      if (!changed) {
        onDone(`Kept provider as ${chalk.bold(getActiveProviderConfig().name)}`, {
          display: 'system',
        })
        return
      }

      onDone(
        `Saved provider preference as ${provider.name}. Current session still uses ${getProviderConfigById(envOverrideId).name} because environment variables override provider selection.`,
        { display: 'system' },
      )
      return
    }

    const nextModel = getSuggestedModelForProvider(provider.id, mainLoopModel)
    let wasFastModeDisabled = false

    setAppState(prev => {
      wasFastModeDisabled =
        isFastModeEnabled() &&
        !isFastModeSupportedByModel(nextModel) &&
        !!prev.fastMode

      return {
        ...prev,
        mainLoopModel: nextModel,
        mainLoopModelForSession: null,
        ...(wasFastModeDisabled ? { fastMode: false } : {}),
      }
    })

    const changed =
      normalizeProviderSettingValue(previousStoredProviderId) !==
        normalizeProviderSettingValue(provider.id) ||
      mainLoopModel !== nextModel ||
      mainLoopModelForSession !== null

    if (!changed) {
      onDone(`Kept provider as ${chalk.bold(provider.name)}`, {
        display: 'system',
      })
      return
    }

    let message = `Set provider to ${provider.name}`
    message += ` · Model set to ${modelDisplayString(nextModel)}`

    if (wasFastModeDisabled) {
      message += ' · Fast mode OFF'
    }

    onDone(message)
  }, [args, mainLoopModel, mainLoopModelForSession, onDone, setAppState])

  return null
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const trimmedArgs = args?.trim() || ''

  if (COMMON_INFO_ARGS.includes(trimmedArgs)) {
    return <ShowProviderAndClose onDone={onDone} />
  }

  if (COMMON_HELP_ARGS.includes(trimmedArgs)) {
    const availableProviders = getAllProviderConfigs()
      .map(provider => provider.id)
      .join(', ')
    onDone(
      `Run /provider to open the provider selection menu, or /provider [providerId] to set the provider. Available providers: ${availableProviders}`,
      { display: 'system' },
    )
    return
  }

  if (trimmedArgs) {
    return <SetProviderAndClose args={trimmedArgs} onDone={onDone} />
  }

  return <ProviderPickerWrapper onDone={onDone} />
}
