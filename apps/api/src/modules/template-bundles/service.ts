import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDisplayName } from '@repo/db';
import { resolveText, type BundleOffer, type HelenaPlugin, type TemplateBundle } from '@helena/sdk';
import { readBundleDir } from '@helena/sdk/bundles';
import { checkBundle } from '@helena/sdk/server';
import { getMcpApp } from '#mcp/app-ref';
import { HttpError } from '#shared/lib';
import { host, registries } from '#shared/helena';
import { SyncLog, exportBundle, importBundle, type Transport } from './sync';
import { exportDepartmentBundle, importDepartmentBundle } from './department';

// Template bundles in the API ("Vorlagen importieren/exportieren"): importing a bundle
// into a team and exporting a team's templates, with the caller's own rights, and the
// bundles on offer (the repository's bundles/ and those plugins register). The import
// and export are the same code the setup scripts run (sync.ts), talking to the routes
// in process with the caller's credential, so every permission check applies as over
// HTTP.

// The caller's credential, as the headers the planner's session guard reads.
export interface CallerHeaders {
  cookie?: string | null;
  apiKey?: string | null;
  authorization?: string | null;
}

function inProcessTransport(caller: CallerHeaders): Transport {
  const app = getMcpApp();
  return async (method, path, body) => {
    const headers: Record<string, string> = {};
    if (caller.cookie) headers.cookie = caller.cookie;
    if (caller.apiKey) headers['x-api-key'] = caller.apiKey;
    if (caller.authorization) headers.authorization = caller.authorization;
    let payload: FormData | string | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await app.handle(
      new Request(`http://localhost${path}`, { method, headers, body: payload }),
    );
    return { ok: response.ok, status: response.status, text: () => response.text() };
  };
}

export interface BundleReport {
  lines: string[];
  written: number;
  unchanged: number;
  drift: number;
  warnings: number;
  summary: string;
}

function report(log: SyncLog): BundleReport {
  return {
    lines: log.lines,
    written: log.written,
    unchanged: log.unchanged,
    drift: log.drift,
    warnings: log.warnings,
    summary: log.summary(),
  };
}

// Imports a bundle: creates what the team is missing, reports what differs (drift) and
// overwrites it only with `update`. A dry run writes nothing.
export async function importTemplateBundle(
  teamId: number,
  caller: CallerHeaders,
  input: { bundle?: unknown; offer?: string; dryRun?: boolean; update?: boolean },
): Promise<BundleReport> {
  let bundle: TemplateBundle;
  if (input.offer) {
    const offer = registries.bundles.get(input.offer);
    if (!offer) throw new HttpError(404, `No bundle ${input.offer} is on offer`);
    bundle = offer.bundle;
  } else {
    try {
      bundle = checkBundle(input.bundle);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }
  const log = new SyncLog(inProcessTransport(caller), {
    dryRun: input.dryRun === true,
    update: input.update === true,
  });
  try {
    await importBundle(log, teamId, bundle);
  } catch (error) {
    log.warn(`Stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
  return report(log);
}

export async function exportTemplateBundle(
  teamId: number,
  caller: CallerHeaders,
  options: { agents?: string[]; name?: string; displayName?: string; version?: string },
): Promise<TemplateBundle> {
  const log = new SyncLog(inProcessTransport(caller), { dryRun: true, update: false });
  return exportBundle(log, teamId, {
    productName: await getDisplayName(),
    ...(options.agents?.length ? { agents: options.agents } : {}),
    ...(options.name ? { name: options.name } : {}),
    ...(options.displayName ? { displayName: options.displayName } : {}),
    ...(options.version ? { version: options.version } : {}),
  });
}

export async function exportDepartmentTemplate(
  teamId: number,
  departmentId: number,
  caller: CallerHeaders,
): Promise<TemplateBundle> {
  const log = new SyncLog(inProcessTransport(caller), { dryRun: true, update: false });
  const bundle = await exportDepartmentBundle(log, teamId, departmentId);
  try {
    return checkBundle(bundle);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : String(error));
  }
}

export async function importDepartmentTemplate(
  teamId: number,
  userId: string,
  caller: CallerHeaders,
  input: { bundle: unknown; dryRun?: boolean; update?: boolean },
): Promise<BundleReport> {
  let bundle: TemplateBundle;
  try {
    bundle = checkBundle(input.bundle);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : String(error));
  }
  if (!bundle.department) throw new HttpError(400, 'Bundle has no department');
  const log = new SyncLog(inProcessTransport(caller), {
    dryRun: input.dryRun === true,
    update: input.update === true,
  });
  try {
    await importDepartmentBundle(log, teamId, userId, bundle);
  } catch (error) {
    log.warn(`Stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
  return report(log);
}

export interface BundleOfferView {
  id: string;
  label: string;
  description: string | null;
  pluginId: string;
  version: string;
  agents: number;
  skills: number;
  mcpServers: number;
}

export function bundleOffers(): BundleOfferView[] {
  return registries.bundles.entriesList().map(({ value: offer, pluginId }) => ({
    id: offer.id,
    label: resolveText(offer.label, 'en'),
    description: offer.description ? resolveText(offer.description, 'en') : null,
    pluginId,
    version: offer.bundle.version,
    agents: offer.bundle.agents.length,
    skills: offer.bundle.skills.length,
    mcpServers: Object.keys(offer.bundle.mcpServers).length,
  }));
}

// The repository's own bundles (bundles/<name>/, the agent pool first of all), offered as
// the internal plugin helena.bundles.
const BUNDLES_DIR = join(import.meta.dir, '../../../../../bundles');

const repositoryBundles: HelenaPlugin = {
  register(ctx) {
    if (!existsSync(BUNDLES_DIR)) return;
    for (const name of readdirSync(BUNDLES_DIR).sort()) {
      const dir = join(BUNDLES_DIR, name);
      if (!existsSync(join(dir, 'helena.bundle.json'))) continue;
      try {
        const bundle = readBundleDir(dir);
        const offer: BundleOffer = {
          id: bundle.name,
          label: bundle.displayName,
          description: bundle.description,
          bundle,
        };
        ctx.bundles.register(offer);
      } catch (error) {
        ctx.log.error(`bundle ${name} not offered: ${String(error)}`);
      }
    }
  },
};

export async function loadRepositoryBundles(): Promise<void> {
  if (host.get('helena.bundles')) return;
  await host.load(repositoryBundles, {
    id: 'helena.bundles',
    name: { i18n: 'god.plugins.names.bundles' },
    version: '1.0.0',
    sdk: '^0.1.0',
    provides: { bundles: ['*'] },
  });
}
