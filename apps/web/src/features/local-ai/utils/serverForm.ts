import type {
  ConfigurableCapability,
  LocalAiSettings,
  ServerInput,
  ServerLoad,
} from '@/lib/api/endpoints/localAi';

// The model server dialog's state and what it sends, and the facts of a server's load line.
// Pure, so they are tested without rendering.

export const CAPABILITIES: readonly ConfigurableCapability[] = ['tools', 'reasoning', 'vision'];

// The Lemonade installer's key file (native/local-ai/install.sh).
const DEFAULT_KEY_FILE = '/etc/helena/local-ai.key';

export interface ServerForm {
  slug: string;
  kind: string;
  name: string;
  baseUrl: string;
  keySource: 'file' | 'stored' | 'none';
  keyFile: string;
  key: string;
  // Digits only; empty keeps the server's (or Helena's default).
  contextLength: string;
  // null: what Helena reads from the server.
  capabilities: ConfigurableCapability[] | null;
}

// A new server of a kind, with that kind's defaults (address, where its key comes from).
export function newServerForm(settings: LocalAiSettings, kind: string): ServerForm {
  const type = settings.serverTypes.find((entry) => entry.id === kind);
  const keySource = type?.defaultKeySource ?? 'file';
  return {
    slug: settings.servers.length === 0 ? 'local' : kind === 'halogen' ? 'halogen' : '',
    kind,
    name: '',
    baseUrl: type?.defaultBaseUrl ?? '',
    keySource,
    keyFile: DEFAULT_KEY_FILE,
    key: '',
    contextLength: '',
    capabilities: null,
  };
}

// What the dialog sends. A change leaves out what it does not change (an empty key keeps the
// stored one; an empty context length keeps the server's).
export function serverInput(
  form: ServerForm,
  capabilitiesConfigurable: boolean,
  editing: boolean,
): ServerInput {
  const context = Number(form.contextLength);
  return {
    ...(editing ? {} : { slug: form.slug.trim(), kind: form.kind }),
    name: form.name.trim() || undefined,
    baseUrl: form.baseUrl.trim(),
    keySource: form.keySource,
    keyFile: form.keySource === 'file' ? form.keyFile.trim() || null : null,
    ...(form.keySource === 'stored' && form.key.trim() ? { key: form.key.trim() } : {}),
    ...(form.contextLength && Number.isInteger(context) && context > 0
      ? { contextLength: context }
      : {}),
    ...(capabilitiesConfigurable
      ? {
          options: {
            capabilities:
              form.capabilities === null
                ? null
                : CAPABILITIES.filter((entry) => form.capabilities!.includes(entry)),
          },
        }
      : {}),
  };
}

export type LoadFact =
  | { kind: 'speed'; output: number; prompt: number | null }
  | { kind: 'slots'; busy: number; slots: number; queued: number }
  | { kind: 'memory'; gb: number }
  | { kind: 'kv'; percent: number }
  | { kind: 'gpu'; percent: number };

// What the card says about a server's load, in this order; nothing the server does not count.
export function loadFacts(load: ServerLoad | null | undefined): LoadFact[] {
  if (!load) return [];
  const facts: LoadFact[] = [];
  if (typeof load.outputTokensPerSecond === 'number')
    facts.push({
      kind: 'speed',
      output: load.outputTokensPerSecond,
      prompt: load.promptTokensPerSecond ?? null,
    });
  if (typeof load.slots === 'number')
    facts.push({
      kind: 'slots',
      busy: load.busySlots ?? 0,
      slots: load.slots,
      queued: load.queued ?? 0,
    });
  if (typeof load.memoryGb === 'number') facts.push({ kind: 'memory', gb: load.memoryGb });
  if (typeof load.kvUsagePercent === 'number')
    facts.push({ kind: 'kv', percent: load.kvUsagePercent });
  if (typeof load.gpuPercent === 'number') facts.push({ kind: 'gpu', percent: load.gpuPercent });
  return facts;
}

// Kingston runs Halogen (Flash), the embedding server (Vulkan), speech recognition and the
// voice; Lemonade is gone (owner, 29.09., K9). A Lemonade entry that is switched off is not
// listed, and none is offered to add; one still switched on stays visible, so nothing that
// runs is hidden.
export const HALOGEN = 'halogen';
export const LEMONADE = 'lemonade';

export function shownServers<T extends { kind: string; enabled: boolean }>(servers: T[]): T[] {
  return servers.filter((server) => server.kind !== LEMONADE || server.enabled);
}

// The kinds the add dialog offers; the kind of a server being edited stays listed.
export function addableServerTypes<T extends { id: string }>(types: T[], current: string): T[] {
  return types.filter((type) => type.id !== LEMONADE || type.id === current);
}
