import { getSetting, setSetting } from '@repo/db';
import { HttpError } from '#shared/lib';
import { assertCron } from '#modules/engine/schedules';

// The update center's settings (Administrator → Updates): when the check runs on its own,
// and how what changed is summarized. The summary runs on a Hermes agent with a small model;
// null agent and model are "Automatisch" (updates/digest.ts picks them).

const SETTINGS_KEY = 'helenaUpdates';

export interface UpdateSettings {
  // The scheduled check (engine system job `helena.updates`).
  enabled: boolean;
  cron: string;
  timezone: string;
  // Whether a small model summarizes what a new version changes.
  summarize: boolean;
  agentId: number | null;
  model: string | null;
  reasoning: string;
  // The Claude Code release channel the check compares with: `latest` (what the pins track)
  // or `stable`.
  claudeChannel: 'latest' | 'stable';
}

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  enabled: true,
  cron: '0 6 * * *',
  timezone: 'Europe/Berlin',
  summarize: true,
  agentId: null,
  model: null,
  reasoning: 'low',
  claudeChannel: 'latest',
};

const REASONING = /^[a-z]{2,16}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;

function clean(stored: Partial<UpdateSettings>, base: UpdateSettings): UpdateSettings {
  const cron = typeof stored.cron === 'string' && stored.cron.trim() ? stored.cron.trim() : null;
  const timezone =
    typeof stored.timezone === 'string' && stored.timezone.trim() ? stored.timezone.trim() : null;
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : base.enabled,
    cron: cron ?? base.cron,
    timezone: timezone ?? base.timezone,
    summarize: typeof stored.summarize === 'boolean' ? stored.summarize : base.summarize,
    agentId:
      stored.agentId === null
        ? null
        : Number.isInteger(stored.agentId) && (stored.agentId as number) > 0
          ? (stored.agentId as number)
          : base.agentId,
    model:
      stored.model === null
        ? null
        : typeof stored.model === 'string' && MODEL.test(stored.model)
          ? stored.model
          : base.model,
    reasoning:
      typeof stored.reasoning === 'string' && REASONING.test(stored.reasoning)
        ? stored.reasoning
        : base.reasoning,
    claudeChannel:
      stored.claudeChannel === 'stable' || stored.claudeChannel === 'latest'
        ? stored.claudeChannel
        : base.claudeChannel,
  };
}

export async function getUpdateSettings(): Promise<UpdateSettings> {
  const stored = (await getSetting<Partial<UpdateSettings>>(SETTINGS_KEY)) ?? {};
  return clean(stored, DEFAULT_UPDATE_SETTINGS);
}

export async function setUpdateSettings(patch: Partial<UpdateSettings>): Promise<UpdateSettings> {
  const current = await getUpdateSettings();
  const next = clean(patch, current);
  if (patch.cron !== undefined || patch.timezone !== undefined) {
    assertCron(next.cron, next.timezone);
  }
  if (patch.model !== undefined && patch.model !== null && next.model !== patch.model) {
    throw new HttpError(400, 'Invalid model');
  }
  await setSetting(SETTINGS_KEY, next);
  return next;
}

// ── What the summaries learned ──────────────────────────────────────────────────────────

const REFUSED_KEY = 'helenaUpdatesRefusedModels';
const REFUSED_FOR_MS = 7 * 86_400_000;

// Models a digest run was refused on ("not supported with your account"): the automatic
// choice skips them for a week.
export async function refusedModels(now = Date.now()): Promise<Set<string>> {
  const stored = (await getSetting<Record<string, string>>(REFUSED_KEY)) ?? {};
  return new Set(
    Object.entries(stored)
      .filter(([, at]) => now - Date.parse(at) < REFUSED_FOR_MS)
      .map(([model]) => model),
  );
}

export async function rememberRefusedModel(model: string, now = new Date()): Promise<void> {
  const stored = (await getSetting<Record<string, string>>(REFUSED_KEY)) ?? {};
  const kept = Object.fromEntries(
    Object.entries(stored).filter(([, at]) => now.getTime() - Date.parse(at) < REFUSED_FOR_MS),
  );
  await setSetting(REFUSED_KEY, { ...kept, [model]: now.toISOString() });
}
