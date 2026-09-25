import semver from 'semver';
import { z } from 'zod';
import { ACTION_CATEGORIES } from '../actions';
import type { PluginManifest } from '../manifest-types';
import { SDK_VERSION } from '../version';

// The manifest schema, the one source of both the validation here and the published JSON
// Schema (schema/helena.plugin.schema.json, written by `bun run schema`).

export const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,40}(\.[a-z0-9][a-z0-9-]{0,40}){0,3}$/;
const MCP_SERVER_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ENTRY = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+\.(?:js|mjs|ts)$/;

const localizedText = z.union([
  z.string().min(1),
  z.object({ i18n: z.string().min(1) }).strict(),
  z.record(z.string().regex(/^[a-z]{2}(-[A-Za-z]{2,4})?$/), z.string().min(1)),
]);

const actionCategory = z.enum(ACTION_CATEGORIES);
const ids = z.array(z.string().min(1).max(160)).max(500);

const mcpServer = z
  .object({
    name: z.string().regex(MCP_SERVER_NAME),
    title: localizedText.optional(),
    description: localizedText.optional(),
    transport: z.enum(['stdio', 'http']),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.url().optional(),
    toolCategories: z.record(z.string(), actionCategory).optional(),
  })
  .strict()
  .refine((server) => (server.transport === 'stdio' ? !!server.command : !!server.url), {
    message: 'A stdio server needs a command, an http server a url',
  });

export const pluginManifestSchema = z
  .object({
    $schema: z.string().optional(),
    id: z.string().regex(PLUGIN_ID, 'lowercase words separated by dots, e.g. acme.jira'),
    name: localizedText,
    version: z.string().refine((value) => semver.valid(value) !== null, 'a semver version'),
    description: localizedText.optional(),
    author: z.string().optional(),
    license: z.string().optional(),
    homepage: z.url().optional(),
    sdk: z.string().refine((value) => semver.validRange(value) !== null, 'a semver range'),
    main: z
      .object({
        server: z.string().regex(ENTRY).optional(),
        runner: z.string().regex(ENTRY).optional(),
      })
      .strict()
      .optional(),
    provides: z
      .object({
        runtimes: ids.optional(),
        connectors: ids.optional(),
        tools: ids.optional(),
        stepTypes: ids.optional(),
        triggerTypes: ids.optional(),
        policies: ids.optional(),
        uiSlots: ids.optional(),
        knowledgeSources: ids.optional(),
        captureTargets: ids.optional(),
        bundles: ids.optional(),
        hostCapabilities: ids.optional(),
        profileContributions: ids.optional(),
        usageLimitSources: ids.optional(),
        runtimeLoginSources: ids.optional(),
        modelServers: ids.optional(),
        localAiTaskClasses: ids.optional(),
        updateSources: ids.optional(),
        decisionBackends: ids.optional(),
        decisionClasses: ids.optional(),
        events: ids.optional(),
        mcpServers: z.array(mcpServer).max(50).optional(),
      })
      .strict(),
    permissions: z
      .object({
        actions: z.array(actionCategory).optional(),
        events: z.array(z.string().min(1)).optional(),
        network: z.array(z.string().min(1)).optional(),
        credentials: z.boolean().optional(),
      })
      .strict()
      .optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict() satisfies z.ZodType<PluginManifest>;

export class ManifestError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'ManifestError';
  }
}

// Parses a manifest and checks that this SDK is in its range. Built-in plugins
// (`helena.*`) are only accepted from the monorepo.
export function parseManifest(raw: unknown, options: { builtin?: boolean } = {}): PluginManifest {
  const result = pluginManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ManifestError(`Invalid plugin manifest: ${issues.join('; ')}`, issues);
  }
  const manifest = result.data as PluginManifest;
  if (!options.builtin && (manifest.id === 'helena' || manifest.id.startsWith('helena.'))) {
    throw new ManifestError(`The plugin id "${manifest.id}" is reserved for Helena's own plugins`);
  }
  if (!semver.satisfies(SDK_VERSION, manifest.sdk, { includePrerelease: true })) {
    throw new ManifestError(
      `${manifest.id} needs @helena/sdk ${manifest.sdk}; this Helena has ${SDK_VERSION}`,
    );
  }
  return manifest;
}

export function manifestJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(pluginManifestSchema, { target: 'draft-2020-12', io: 'input' });
  return {
    $schema: schema.$schema,
    $id: 'urn:helena:schema:plugin-manifest:v1',
    title: 'Helena plugin manifest',
    ...schema,
  };
}
