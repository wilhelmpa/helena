import type {
  MatrixColumn,
  MatrixRuntime,
  MatrixSchema,
  MatrixValues,
  ModelMatrix,
  SchemaCatalogModel,
} from '@/lib/api/endpoints/modelMatrix';
import { RUNTIMES } from './columns';

// Helpers for the editor of a custom schema: what its cells may hold (the catalog the server
// checks a change against), what a change to one cell drags along, and the id a new schema gets.

export const LOCAL_DEFAULT_MODEL = 'volition-local-default';

// The runtimes the catalog has a model for. A runtime without one (a command, a webhook)
// cannot be given to a role: the server refuses a role whose model it does not know.
export function catalogRuntimes(catalog: SchemaCatalogModel[]): MatrixRuntime[] {
  const known = new Set(catalog.map((entry) => entry.runtime));
  return RUNTIMES.filter((runtime) => known.has(runtime));
}

// The models a runtime offers; the local default first.
export function catalogModels(
  catalog: SchemaCatalogModel[],
  runtime: string,
): SchemaCatalogModel[] {
  return catalog
    .filter((entry) => entry.runtime === runtime)
    .sort(
      (a, b) =>
        Number(b.id === LOCAL_DEFAULT_MODEL) - Number(a.id === LOCAL_DEFAULT_MODEL) ||
        a.name.localeCompare(b.name),
    );
}

// The thinking levels of one model, `null` (no explicit level) first. A model the catalog does
// not know offers only that.
export function catalogLevels(
  catalog: SchemaCatalogModel[],
  runtime: string,
  model: string,
): (string | null)[] {
  const entry = catalog.find((item) => item.runtime === runtime && item.id === model);
  return [null, ...(entry?.thinkingLevels ?? [])];
}

// The values of a role after one cell changed. The cells that depend on it follow: a new
// runtime brings a model and a device that fit it, a new model keeps the thinking level only
// where it offers it.
export function changeRoleCell(
  current: MatrixValues,
  column: MatrixColumn,
  value: MatrixValues[MatrixColumn],
  catalog: SchemaCatalogModel[],
): Partial<MatrixValues> {
  const next: Partial<MatrixValues> = { [column]: value };
  if (column === 'runtime') {
    const runtime = value as MatrixRuntime;
    const models = catalogModels(catalog, runtime);
    const model = models.some((entry) => entry.id === current.model)
      ? current.model
      : (models[0]?.id ?? current.model);
    if (model !== current.model) next.model = model;
    if (!catalogLevels(catalog, runtime, model).includes(current.reasoning)) next.reasoning = null;
    if (runtime === 'helena' && current.device === 'cloud') next.device = 'gpu';
    if (runtime !== 'helena' && current.device === 'gpu') next.device = 'cloud';
  }
  if (
    column === 'model' &&
    !catalogLevels(catalog, current.runtime, value as string).includes(current.reasoning)
  )
    next.reasoning = null;
  return next;
}

// An id for a new schema: the name in the letters and digits the server accepts, made unique
// among the schemas there are.
export function schemaIdFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    name
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 56)
      .replace(/-+$/, '') || 'schema';
  const start = base.length >= 2 ? base : `${base}-1`;
  if (!used.has(start)) return start;
  for (let n = 2; ; n += 1) {
    const candidate = `${start.slice(0, 60)}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

// Where a schema is used: the active one and the schemas of projects. Such a schema cannot be
// deleted.
export function schemaUse(matrix: ModelMatrix, schemaId: string) {
  return {
    active: matrix.active === schemaId,
    projects: Object.entries(matrix.projects)
      .filter(([, id]) => id === schemaId)
      .map(([projectId]) => Number(projectId)),
  };
}

// The roles a schema can still be given, in the order of the matrix.
export function missingRoles(schema: MatrixSchema, roles: readonly string[]): string[] {
  return roles.filter((role) => !(role in schema.roles));
}
