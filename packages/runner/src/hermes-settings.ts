import { registerProfileContribution } from './contributions';

// The Hermes settings Helena keeps per agent (runtime policy) and for the instance, written
// into the agent's managed configuration: skills.disabled, the fallback chain
// (fallback_providers) and how long Hermes keeps ended sessions (sessions.retention_days).
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
    };
  },
});
