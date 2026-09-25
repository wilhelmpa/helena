import type { RuntimeCompression } from '@helena/sdk';
import { registerProfileContribution } from './contributions';

// The Hermes settings Helena keeps per agent (runtime policy) and for the instance, written
// into the agent's managed configuration: skills.disabled, the fallback chain
// (fallback_providers), how long Hermes keeps ended sessions (sessions.retention_days) and
// how it compresses a long conversation (compression.*, auxiliary.compression;
// docs/helena-decisions/agent-context.md §6).

// Hermes' keys for Helena's compression settings (hermes_cli/config_defaults.py "compression",
// read by agent/agent_init.py _parse_compression_config): the token cap of the trigger, the
// share of it the compressed context keeps, and the idle time after which a resumed session
// is compressed before it answers. The summarising model is an auxiliary task of its own.
export function hermesCompressionConfig(
  compression: RuntimeCompression | undefined,
): Record<string, unknown> {
  if (!compression) return {};
  return {
    compression: {
      threshold_tokens: compression.thresholdTokens,
      ...(compression.targetRatio !== undefined && { target_ratio: compression.targetRatio }),
      ...(compression.idleCompactAfterSeconds !== undefined && {
        idle_compact_after_seconds: compression.idleCompactAfterSeconds,
      }),
    },
    ...(compression.model && {
      auxiliary: {
        compression: { provider: compression.model.provider, model: compression.model.model },
      },
    }),
  };
}

registerProfileContribution({
  id: 'hermes-settings',
  hermesConfig: ({ snapshot }) => {
    const settings = snapshot.hermes;
    if (!settings) return {};
    return {
      ...(settings.skillsDisabled && { skills: { disabled: settings.skillsDisabled } }),
      ...(settings.fallbackModels && { fallback_providers: settings.fallbackModels }),
      ...(settings.sessionRetentionDays && {
        sessions: { retention_days: settings.sessionRetentionDays },
      }),
      ...hermesCompressionConfig(settings.compression),
    };
  },
});
