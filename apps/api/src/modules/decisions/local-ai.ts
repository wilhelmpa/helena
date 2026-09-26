import { readLocalAiPolicy, readModelServerKey, resolveLocalRoute } from '@repo/db';
import { HttpError } from '#shared/lib';
import { useModelServerResolver } from '#modules/browser-task/connection';
import { LOCAL_AI_DECISIONS_CLASS } from './local-ai-class';
import { useDecisionGate } from './service';

// A decision connection "Lokale KI auf diesem Server" goes through Helena's registered local AI
// (docs/helena-decisions/local-ai-platform.md §6.6 (b)): the server and the model Lokale KI
// routes the class `decisions` to, with the server's key, which never leaves the API. A refusal
// (master switch or class off, unit off, server down, the model's eval failed) is an error of
// that connection, so decide() tries the fallback connection or the caller keeps its default.
const REFUSALS: Record<string, string> = {
  'master-off': 'Local AI is switched off',
  'class-off': 'Local AI does not take decisions (Lokale KI → Entscheidungen is off)',
  'unit-off': "The local AI's GPU is switched off",
  'no-server': 'No local AI model server is set up',
  'server-down': 'The local AI model server does not answer',
  'no-model': 'The local AI server has no model for decisions',
  'eval-failed': "The local model's newest eval for decisions failed",
};

export function useLocalAiForDecisions(): void {
  useModelServerResolver(async (slug) => {
    const result = await resolveLocalRoute({
      classId: LOCAL_AI_DECISIONS_CLASS,
      unit: 'gpu',
      capability: 'chat',
    });
    if ('refusal' in result) {
      throw new HttpError(409, REFUSALS[result.refusal] ?? `Local AI refused (${result.refusal})`);
    }
    const { server, model } = result.route;
    // A connection that names another server than the one Lokale KI routes to is not used:
    // the owner picks the server in Lokale KI.
    if (slug !== 'local' && slug !== server.slug) {
      throw new HttpError(409, `Lokale KI routes decisions to "${server.slug}", not "${slug}"`);
    }
    return { baseUrl: server.baseUrl, key: await readModelServerKey(server), model };
  });
  // "Nur lokal" for decisions: nothing of them leaves the machine, the fallback included.
  useDecisionGate(async ({ local }) => {
    if (local) return null;
    const policy = await readLocalAiPolicy();
    return policy.enabled && policy.classes[LOCAL_AI_DECISIONS_CLASS]?.mode === 'only'
      ? 'Lokale KI: decisions stay on this machine (Nur lokal)'
      : null;
  });
}

useLocalAiForDecisions();
