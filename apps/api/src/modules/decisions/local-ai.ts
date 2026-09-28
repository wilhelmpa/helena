import { readLocalAiPolicy, readModelServerKey, resolveLocalRoute } from '@repo/db';
import {
  LocalDecisionConnectionError,
  useModelServerResolver,
} from '#modules/browser-task/connection';
import { serverTokenIds } from '#modules/local-ai/service';
import { localAiClassForDecision } from './classes';
import { useDecisionGate } from './service';

// A decision connection "Lokale KI auf diesem Server" goes through Helena's registered local AI
// (docs/helena-decisions/local-ai-platform.md §6.6 (b)): the server and the model Lokale KI
// routes the class `decisions` to, with the server's key, which never leaves the API. A refusal
// (master switch or class off, unit off, server down, the model's eval failed) is an error of
// that connection, so decide() tries the fallback connection or the caller keeps its default.

export function useLocalAiForDecisions(): void {
  useModelServerResolver(async (slug, classId) => {
    const result = await resolveLocalRoute({
      classId,
      unit: 'gpu',
      capability: 'chat',
    });
    if ('refusal' in result) {
      throw new LocalDecisionConnectionError(result.refusal);
    }
    const { server, model } = result.route;
    // A connection that names another server than the one Lokale KI routes to is not used:
    // the owner picks the server in Lokale KI.
    if (slug !== 'local' && slug !== server.slug) {
      throw new LocalDecisionConnectionError('route-changed');
    }
    const key = await readModelServerKey(server);
    // A server that takes logit_bias by token id only (Halogen) looks the letters up in its
    // model's tokenizer; the others take the letters themselves.
    const tokenIds = serverTokenIds(server, key);
    return { baseUrl: server.baseUrl, key, model, ...(tokenIds && { tokenIds }) };
  });
  // "Nur lokal" for decisions: nothing of them leaves the machine, the fallback included.
  useDecisionGate(async ({ local, classId }) => {
    if (local) return null;
    const policy = await readLocalAiPolicy();
    const localClass = localAiClassForDecision(classId);
    return policy.enabled && policy.classes[localClass]?.mode === 'only'
      ? 'Lokale KI: decisions stay on this machine (Nur lokal)'
      : null;
  });
}

useLocalAiForDecisions();
