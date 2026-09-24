import type { LocalizedText } from './text';

// Templates and packs travel as files: an agent template, a skill pack, a project or a
// workflow template exported from one Helena and imported into another, or shipped by a
// plugin. A bundle is one JSON document (`*.helena.json`) of a known kind; each kind has
// an importer and an exporter that the feature owning it registers.

export const BUNDLE_FORMAT = 'helena.bundle/v1';

export type TemplateKindId =
  'agent-template' | 'skill-pack' | 'project-template' | 'workflow-template' | (string & {});

export interface TemplateBundle<Item = unknown> {
  format: typeof BUNDLE_FORMAT;
  kind: TemplateKindId;
  id: string;
  name: string;
  version: string;
  description?: string;
  // Who made it and under which license, shown before import.
  author?: string;
  license?: string;
  items: Item[];
}

export interface ImportContext {
  teamId: number;
  projectId?: number | null;
  actor: string;
  // Report what would change without writing.
  dryRun: boolean;
}

export interface ImportReport {
  created: string[];
  updated: string[];
  skipped: Array<{ item: string; reason: string }>;
}

export interface TemplateKind<Item = unknown> {
  id: TemplateKindId;
  label: LocalizedText;
  // Checks one item and returns it typed, or throws with a reason.
  parseItem(raw: unknown): Item;
  export?(ctx: { teamId: number; ids: string[] }): Promise<Item[]>;
  import(items: Item[], ctx: ImportContext): Promise<ImportReport>;
}

export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleError';
  }
}

// Reads a bundle's envelope. The items are checked by the kind's own parseItem.
export function parseBundle(raw: unknown): TemplateBundle<unknown> {
  if (!raw || typeof raw !== 'object') throw new BundleError('A bundle is a JSON object');
  const bundle = raw as Record<string, unknown>;
  if (bundle.format !== BUNDLE_FORMAT) {
    throw new BundleError(
      `Unknown bundle format ${String(bundle.format)}; expected ${BUNDLE_FORMAT}`,
    );
  }
  for (const field of ['kind', 'id', 'name', 'version'] as const) {
    if (typeof bundle[field] !== 'string' || !bundle[field]) {
      throw new BundleError(`The bundle has no ${field}`);
    }
  }
  if (!Array.isArray(bundle.items)) throw new BundleError('The bundle has no items');
  return bundle as unknown as TemplateBundle<unknown>;
}

export function createBundle<Item>(
  init: Omit<TemplateBundle<Item>, 'format'>,
): TemplateBundle<Item> {
  return { format: BUNDLE_FORMAT, ...init };
}
