'use client';

import { Cpu } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type {
  NeedsYouEntry,
  NeedsYouSource,
  NeedsYouSourceResult,
} from '@/extensions/needsYouSources';
import { resolveLabel, shortModel } from '../utils/localAi';
import { useLocalAiSettings, useLocalAiStatus } from './localAi.service';

export const LOCAL_AI_SETTINGS_PATH = '/god/local-ai';

// Local AI's red problems in Start's "Braucht dich" (docs/helena-decisions/dashboard.md), for
// the Administrator and only while local AI is on: an enabled model server that does not
// answer, and a kind of work whose model failed its newest eval (after an update; it runs on
// its configured model meanwhile). Both open Administrator → Lokale KI, where they are fixed.
function useLocalAiProblems({ owner }: { owner: boolean }): NeedsYouSourceResult {
  const t = useTranslations('localAi');
  const locale = useLocale();
  const status = useLocalAiStatus(owner);
  const settings = useLocalAiSettings(owner);
  if (!owner) return { entries: [], isPending: false };
  if (!status.data) return { entries: [], isPending: status.isPending };
  if (!status.data.enabled) return { entries: [], isPending: false };
  const servers: NeedsYouEntry[] = status.data.servers
    .filter((server) => server.enabled && !server.reachable)
    .map((server) => ({
      key: `problem:local-ai:server:${server.id}`,
      kind: 'problem',
      at: server.checkedAt ?? '',
      title: t('problems.serverDown', { name: server.name }),
      detail: server.error ?? '',
      href: LOCAL_AI_SETTINGS_PATH,
      icon: Cpu,
    }));
  const evals: NeedsYouEntry[] = (settings.data?.classes ?? [])
    .filter((entry) => entry.mode !== 'off' && entry.blocker === 'eval-failed')
    .map((entry) => {
      const latest = settings.data?.evals.find(
        (item) => item.classId === entry.id && item.modelId === entry.resolvedModel,
      );
      return {
        key: `problem:local-ai:eval:${entry.id}`,
        kind: 'problem',
        at: latest?.ranAt ?? '',
        title: t('problems.evalFailed', {
          class: resolveLabel(entry.label, locale, (key) => t(key as never)),
        }),
        detail: t('problems.evalFailedDetail', { model: shortModel(entry.resolvedModel) }),
        href: LOCAL_AI_SETTINGS_PATH,
        icon: Cpu,
      };
    });
  return { entries: [...servers, ...evals], isPending: settings.isPending };
}

// After the system's (10), the machine's (15) and the host audit's (17) problems, before the
// approvals (20).
export const localAiNeedsYouSource: NeedsYouSource = {
  id: 'local-ai',
  order: 18,
  useEntries: useLocalAiProblems,
};
