import { getSetting, setSetting } from '@repo/db';
import { normalizeEscalation, type EscalationPatch, type EscalationSettings } from './rules';

// The escalation rules as one setting (rules.ts). The Administrator reads and changes them in
// Lokale KI → Eskalation; native snapshots and failed local runs use these rules.

export const ESCALATION_SETTING_KEY = 'helena.escalation';

export async function readEscalation(): Promise<EscalationSettings> {
  return normalizeEscalation(await getSetting(ESCALATION_SETTING_KEY));
}

// A change replaces what it names: the rules of a kind by kind, the pins as a whole list.
export async function writeEscalation(patch: EscalationPatch): Promise<EscalationSettings> {
  const current = await readEscalation();
  const next = normalizeEscalation({
    ...current,
    ...patch,
    kinds: patch.kinds
      ? current.kinds.map((entry) => patch.kinds!.find((item) => item.kind === entry.kind) ?? entry)
      : current.kinds,
    uncertainty: { ...current.uncertainty, ...patch.uncertainty },
    failure: { ...current.failure, ...patch.failure },
  });
  await setSetting(ESCALATION_SETTING_KEY, next);
  return next;
}
