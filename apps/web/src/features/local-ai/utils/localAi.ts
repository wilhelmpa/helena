import type {
  ClassBlocker,
  LocalAiClass,
  LocalAiStatus,
  LocalAiUnit,
  LocalizedText,
} from '@/lib/api/endpoints/localAi';

// Pure helpers of the "Lokale KI" card and page: how a unit reads, what a class toggle may do,
// the share of tokens that stayed local, and a model id as a person reads it.

export const UNITS: readonly LocalAiUnit[] = ['gpu', 'npu', 'cpu'];

// A localized label from the API: a key of Helena's own messages, or the plugin's text.
export function resolveLabel(
  label: LocalizedText | null | undefined,
  locale: string,
  t: (key: string) => string,
): string {
  if (!label) return '';
  if (typeof label === 'string') return label;
  if (typeof label.i18n === 'string' && Object.keys(label).length === 1) {
    const key = label.i18n.replace(/^localAi\./, '');
    return t(key);
  }
  const language = locale.split('-')[0] ?? locale;
  return label[locale] ?? label[language] ?? label.en ?? Object.values(label)[0] ?? '';
}

// `helena-local/Qwen3.6-35B-A3B-GGUF` → `Qwen3.6-35B-A3B-GGUF`.
export function shortModel(modelId: string | null | undefined): string {
  if (!modelId) return '';
  const slash = modelId.indexOf('/');
  return slash > 0 && modelId.startsWith('helena-') ? modelId.slice(slash + 1) : modelId;
}

export function isLocalModelId(modelId: string | null | undefined): boolean {
  return /^helena-[a-z0-9-]+\//.test(modelId ?? '');
}

export type UnitState = 'off' | 'missing' | 'idle' | 'busy';

// What the card says about a unit: off (the owner turned it off), missing (no device, e.g.
// the NPU before kernel 7), busy (a model loaded and working), idle.
export function unitState(status: LocalAiStatus, unit: LocalAiUnit): UnitState {
  const entry = status.units[unit];
  if (!entry.allowed) return 'off';
  if (!entry.present) return 'missing';
  if (unit === 'gpu') return 'idle';
  if ((entry.busyPercent ?? 0) >= 5) return 'busy';
  return 'idle';
}

export function gib(bytes: number | null | undefined): string {
  if (bytes == null) return '–';
  return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GiB`;
}

// The share of the agents' tokens that ran locally in the window, 0–100, or null for none.
export function localShare(usage: LocalAiStatus['usage']): number | null {
  const total = usage.localTokens + usage.cloudTokens;
  return total > 0 ? Math.round((usage.localTokens / total) * 100) : null;
}

// A class's switch on the card: it may be turned on only when Helena sends the work there
// and its model passed the eval; the reason otherwise. An experimental class is never part
// of the plain on/off.
export function classToggle(entry: Pick<LocalAiClass, 'mode' | 'blocker' | 'experimental'>): {
  checked: boolean;
  disabled: boolean;
  reason: ClassBlocker | null;
} {
  const checked = entry.mode !== 'off';
  const reason = entry.blocker;
  // A class that is on but whose model failed its newest eval (after an update) runs on its
  // configured model: it stays switched on, and says why it is not local.
  return {
    checked,
    disabled: !checked && reason !== null,
    reason: checked && reason !== 'eval-failed' ? null : reason,
  };
}

export function percent(value: number | null | undefined): string {
  return value == null ? '–' : `${Math.round(value)} %`;
}

// The GPU's memory as the card shows it. With a small BIOS carve-out (UMA 512 MB, since
// 28 Sept 2026) the models live in GTT, system memory the GPU maps: then GTT is what counts.
export function gpuMemory(gpu: {
  vramUsedBytes: number | null;
  vramTotalBytes: number | null;
  gttUsedBytes: number | null;
  gttTotalBytes: number | null;
}): { used: number | null; total: number; kind: 'vram' | 'gtt' } | null {
  const vram = gpu.vramTotalBytes;
  const gtt = gpu.gttTotalBytes;
  if (gtt != null && (vram == null || vram < 4 * 1024 ** 3))
    return { used: gpu.gttUsedBytes, total: gtt, kind: 'gtt' };
  if (vram != null) return { used: gpu.vramUsedBytes, total: vram, kind: 'vram' };
  return null;
}

// The kinds of work on the settings page: those that run locally now, those ready to switch
// on, and the rest (waiting for an eval, not wired yet, experimental) folded away.
export function groupClasses<T extends Pick<LocalAiClass, 'mode' | 'blocker' | 'experimental'>>(
  classes: T[],
): { active: T[]; ready: T[]; more: T[] } {
  const active = classes.filter((entry) => entry.mode !== 'off');
  const ready = classes.filter(
    (entry) => entry.mode === 'off' && entry.blocker === null && !entry.experimental,
  );
  const more = classes.filter((entry) => !active.includes(entry) && !ready.includes(entry));
  return { active, ready, more };
}
