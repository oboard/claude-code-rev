import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import { getProviderDisplayName } from '../../utils/model/providerConfig.js'

export default {
  type: 'local-jsx',
  name: 'provider',
  get description() {
    return `Set the model provider for Claude Code (currently ${getProviderDisplayName()})`
  },
  argumentHint: '[provider]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./provider.js'),
} satisfies Command
