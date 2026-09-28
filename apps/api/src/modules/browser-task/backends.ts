import type { DecisionBackendType, HelenaPlugin } from '@helena/sdk';
import { registries } from '#shared/helena';
import { useDecisionBackendLookup } from '#modules/agents/credentials/decision-model';
import { DECISIONS_BACKENDS } from '#modules/decisions/classes';

// The decision backends Helena ships (docs/helena-decisions/browser-task.md §3.3), registered as
// the internal plugin "helena.browser-task" at the framework's extension point
// (@helena/sdk decisionBackends): TypeSafe's Jev directly, Jev through the Vercel AI Gateway, and
// any server speaking the same protocol.

export const BROWSER_TASK_PLUGIN_ID = 'helena.browser-task';

export const BUILTIN_DECISION_BACKENDS: DecisionBackendType[] = [
  {
    id: 'typesafe',
    label: { en: 'Jev (TypeSafe Cloud)', de: 'Jev (TypeSafe Cloud)' },
    location: 'cloud',
    defaultBaseUrl: 'https://api.typesafe.ai',
    defaultModel: 'jev-latest',
    policy: 'jev',
    keyRequired: true,
    signupUrl: 'https://console.typesafe.ai/keys',
    providerName: 'typesafe',
  },
  {
    id: 'vercel',
    label: { en: 'Jev via Vercel AI Gateway', de: 'Jev über Vercel AI Gateway' },
    location: 'cloud',
    defaultBaseUrl: 'https://ai-gateway.vercel.sh/typesafe',
    defaultModel: 'typesafe-ai/jev',
    policy: 'jev',
    keyRequired: true,
    signupUrl: 'https://vercel.com/docs/ai-gateway',
    providerName: 'vercel',
  },
  {
    id: 'compatible',
    label: {
      en: 'Jev-compatible server (local or own)',
      de: 'Jev-kompatibler Server (lokal/eigener)',
    },
    location: 'local',
    defaultBaseUrl: null,
    defaultModel: 'jev-latest',
    policy: 'jev',
    keyRequired: false,
    providerName: 'local',
  },
];

export const browserTaskPlugin: HelenaPlugin = {
  register(ctx) {
    for (const backend of BUILTIN_DECISION_BACKENDS) ctx.decisionBackends.register(backend);
  },
};

export function decisionBackend(id: string | null | undefined): DecisionBackendType | null {
  if (!id) return null;
  return (
    registries.decisionBackends.get(id) ??
    [...BUILTIN_DECISION_BACKENDS, ...DECISIONS_BACKENDS].find((backend) => backend.id === id) ??
    null
  );
}

export function decisionBackends(): DecisionBackendType[] {
  const listed = registries.decisionBackends.list();
  return listed.length > 0 ? listed : [...BUILTIN_DECISION_BACKENDS, ...DECISIONS_BACKENDS];
}

// The credential form validates a plugin's backend kind through the same registry.
useDecisionBackendLookup((id) => {
  const backend = decisionBackend(id);
  return backend
    ? {
        defaultBaseUrl: backend.defaultBaseUrl,
        defaultModel: backend.defaultModel,
        keyRequired: backend.keyRequired,
      }
    : null;
});
