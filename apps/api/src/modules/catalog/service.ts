import {
  db,
  catalogSource,
  catalogItem,
  catalogRevision,
  catalogInstall,
  catalogProposal,
  agentSkillLink,
  agentMcpServerLink,
  agentMcpServer,
  agentSkill,
  aiAgent,
  project,
  projectMember,
  teamRole,
} from '@repo/db';
import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { HttpError, iso } from '#shared/lib';
import {
  discoverGithubSkills,
  inspectGithubRepository,
  inspectGithubSkill,
  parseGithubSkillUrl,
} from '#modules/agents/skills/skill-format';
import { createSkillFromFiles, replaceSkillFromFiles } from '#modules/agents/skills/service';
import { createMcpServer, updateMcpServer } from '#modules/agents/mcp-servers/service';
import { onTemplateRelevantChange } from '#modules/agents/core/template-sync';
import {
  identifyLicense,
  hasPossibleSecret,
  inspectMcpPackage,
  inspectSkillFiles,
  inspectionPasses,
  unpackTarGz,
  type Finding,
  type Snapshot,
} from './inspection';

type SourceKind = 'github-skills' | 'npm-mcp' | 'pypi-mcp' | 'github-mcp';
type Scope = { projectId?: number; agentId?: number; roleId?: number };
const repoPattern =
  /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*\/?$/;
const npmPattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const pypiPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validateSource(kind: SourceKind, locator: string): string {
  const value = locator.trim().replace(/\/$/, '');
  if (kind.startsWith('github')) {
    if (!repoPattern.test(value) || value.endsWith('/..') || value.endsWith('/.'))
      throw new HttpError(400, 'Source must be one GitHub repository URL');
    parseGithubSkillUrl(value);
  } else if (kind === 'npm-mcp' ? !npmPattern.test(value) : !pypiPattern.test(value)) {
    throw new HttpError(400, 'Invalid package name');
  }
  return value;
}

export async function listSources(teamId: number) {
  return db
    .select()
    .from(catalogSource)
    .where(eq(catalogSource.teamId, teamId))
    .orderBy(catalogSource.id);
}

export async function addSource(
  teamId: number,
  input: { kind: SourceKind; locator: string; role?: string },
) {
  const locator = validateSource(input.kind, input.locator);
  const [row] = await db
    .insert(catalogSource)
    .values({ teamId, kind: input.kind, locator, role: input.role ?? '', enabled: true })
    .onConflictDoUpdate({
      target: [catalogSource.teamId, catalogSource.kind, catalogSource.locator],
      set: { enabled: true, role: input.role ?? '' },
    })
    .returning();
  return row;
}

async function sourceInTeam(teamId: number, id: number) {
  const [row] = await db
    .select()
    .from(catalogSource)
    .where(and(eq(catalogSource.id, id), eq(catalogSource.teamId, teamId)));
  if (!row) throw new HttpError(404, 'Catalog source not found');
  return row;
}

export async function removeSource(teamId: number, id: number) {
  await sourceInTeam(teamId, id);
  await db.update(catalogSource).set({ enabled: false }).where(eq(catalogSource.id, id));
}

async function upsertItem(sourceId: number, path: string, name: string, description: string) {
  const [row] = await db
    .insert(catalogItem)
    .values({ sourceId, path, name, description })
    .onConflictDoUpdate({
      target: [catalogItem.sourceId, catalogItem.path],
      set: { name, description },
    })
    .returning();
  return row;
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const result = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!result.ok) throw new HttpError(502, `Catalog source returned ${result.status}`);
  if (Number(result.headers.get('content-length') ?? 0) > 1024 * 1024)
    throw new HttpError(413, 'Catalog metadata is too large');
  const text = await result.text();
  if (text.length > 1024 * 1024) throw new HttpError(413, 'Catalog metadata is too large');
  return JSON.parse(text) as Record<string, unknown>;
}

async function fetchArchive(url: string, host: string): Promise<Buffer> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== host ||
    parsed.username ||
    parsed.password
  )
    throw new HttpError(400, 'Package archive URL left the curated registry');
  const result = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!result.ok || !result.body)
    throw new HttpError(502, `Catalog archive returned ${result.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of result.body) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) throw new HttpError(413, 'Catalog archive is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function archiveHash(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}
function requiredEnv(files: { path: string; bytes: Buffer }[]): string[] {
  const names = new Set<string>();
  for (const file of files) {
    if (file.bytes.length > 1024 * 1024 || !/\.(?:md|js|ts|py|json|toml)$/i.test(file.path))
      continue;
    const content = file.bytes.toString('utf8');
    for (const match of content.matchAll(
      /(?:process\.env\.|os\.getenv\(["']|\$\{)([A-Z][A-Z0-9_]{2,})/g,
    ))
      names.add(match[1]);
  }
  return [...names].slice(0, 100).sort();
}

function observedPermissions(files: { path: string; bytes: Buffer }[]): string[] {
  const permissions = new Set(['isolated agent sandbox', 'configured egress']);
  for (const file of files) {
    if (file.bytes.length > 1024 * 1024 || !/\.(?:md|js|ts|py|json|toml|sh)$/i.test(file.path))
      continue;
    const content = file.bytes.toString('utf8');
    if (/\b(?:fetch\(|requests\.|httpx\.|https?\.request|curl\b|wget\b)/.test(content))
      permissions.add('network access through agent egress');
    if (/\b(?:readFile|writeFile|open\(|fs\.|pathlib\.)/.test(content))
      permissions.add('project filesystem access');
    if (/\b(?:spawn\(|exec\(|subprocess\.|os\.system)/.test(content))
      permissions.add('subprocess execution');
  }
  return [...permissions];
}

function npmUrl(name: string) {
  return `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`;
}
function npmVersionUrl(name: string, version: string) {
  return `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
}
function pypiUrl(name: string) {
  return `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
}

async function inspectNpm(name: string, data: Record<string, unknown>) {
  const dist = data.dist as Record<string, unknown> | undefined;
  const version = String(data.version ?? '');
  if (typeof dist?.tarball !== 'string' || typeof dist?.integrity !== 'string')
    throw new HttpError(502, 'npm package has no pinned archive and integrity');
  const archive = await fetchArchive(dist.tarball, 'registry.npmjs.org');
  const [algorithm, expected] = dist.integrity.split('-', 2);
  if (algorithm !== 'sha512' || createHash('sha512').update(archive).digest('base64') !== expected)
    throw new HttpError(502, 'npm package integrity does not match');
  const files = unpackTarGz(archive);
  const packagedManifest = files.find((file) => file.path === 'package/package.json');
  if (!packagedManifest) throw new HttpError(502, 'npm archive has no package.json');
  const packaged = JSON.parse(packagedManifest.bytes.toString('utf8')) as {
    name?: string;
    version?: string;
  };
  if (packaged.name !== name || packaged.version !== version)
    throw new HttpError(502, 'npm archive and registry metadata differ');
  const result = inspectMcpPackage({
    name,
    version,
    license: typeof data.license === 'string' ? data.license : null,
    integrity: dist.integrity,
    archiveSha256: archiveHash(archive),
    files,
    command: 'bunx',
    args: ['--offline', `${name}@${version}`],
    scripts:
      typeof data.scripts === 'object' && data.scripts
        ? (data.scripts as Record<string, string>)
        : {},
    dependencies: [
      ...Object.keys(
        data.dependencies && typeof data.dependencies === 'object'
          ? (data.dependencies as Record<string, unknown>)
          : {},
      ),
      ...Object.keys(
        data.optionalDependencies && typeof data.optionalDependencies === 'object'
          ? (data.optionalDependencies as Record<string, unknown>)
          : {},
      ),
    ],
    environment: requiredEnv(files),
    permissions: observedPermissions(files),
  });
  const archiveLicense = identifyLicense(
    files.map((file) => ({ path: file.path.replace(/^package\//, ''), bytes: file.bytes })),
  );
  if (archiveLicense && archiveLicense !== result.license)
    result.findings.push({
      code: 'license',
      severity: 'block',
      path: 'package/LICENSE',
      detail: 'Archive license differs from registry metadata',
    });
  return result;
}

export async function refreshSource(teamId: number, id: number) {
  const source = await sourceInTeam(teamId, id);
  if (!source.enabled) throw new HttpError(409, 'Catalog source is disabled');
  if (source.kind === 'github-skills') {
    const found = await discoverGithubSkills(source.locator);
    for (const skill of found)
      await upsertItem(
        id,
        skill.subpath,
        hasPossibleSecret(skill.name) ? (skill.subpath.split('/').at(-1) ?? 'Skill') : skill.name,
        hasPossibleSecret(skill.description) ? '[redacted: suspected secret]' : skill.description,
      );
    return { count: found.length };
  }
  if (source.kind === 'github-mcp') {
    await upsertItem(
      id,
      '',
      source.locator.split('/').at(-1) ?? source.locator,
      'GitHub MCP server',
    );
    return { count: 1 };
  }
  const metadata = await fetchJson(
    source.kind === 'npm-mcp' ? npmUrl(source.locator) : pypiUrl(source.locator),
  );
  const info = source.kind === 'pypi-mcp' ? (metadata.info as Record<string, unknown>) : metadata;
  const name = String(info.name ?? source.locator);
  const description = String(info.description ?? info.summary ?? '');
  await upsertItem(
    id,
    '',
    hasPossibleSecret(name) ? source.locator : name,
    hasPossibleSecret(description) ? '[redacted: suspected secret]' : description,
  );
  return { count: 1 };
}

export async function searchCatalog(
  teamId: number,
  query: string,
  window: { limit: number; offset: number },
) {
  const term = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const where = and(
    eq(catalogSource.teamId, teamId),
    or(eq(catalogSource.enabled, true), sql`${catalogInstall.id} IS NOT NULL`),
    query
      ? or(
          ilike(catalogItem.name, term),
          ilike(catalogItem.description, term),
          ilike(catalogSource.role, term),
        )
      : undefined,
  );
  const rows = await db
    .select({
      item: catalogItem,
      source: catalogSource,
      revision: catalogRevision,
      install: catalogInstall,
    })
    .from(catalogItem)
    .innerJoin(catalogSource, eq(catalogSource.id, catalogItem.sourceId))
    .leftJoin(catalogRevision, eq(catalogRevision.id, catalogItem.latestRevisionId))
    .leftJoin(
      catalogInstall,
      and(eq(catalogInstall.itemId, catalogItem.id), eq(catalogInstall.teamId, teamId)),
    )
    .where(where)
    .orderBy(catalogItem.name)
    .limit(window.limit)
    .offset(window.offset);
  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(catalogItem)
    .innerJoin(catalogSource, eq(catalogSource.id, catalogItem.sourceId))
    .leftJoin(
      catalogInstall,
      and(eq(catalogInstall.itemId, catalogItem.id), eq(catalogInstall.teamId, teamId)),
    )
    .where(where);
  const installedIds = rows.flatMap(({ install }) => (install ? [install.revisionId] : []));
  const installedRevisions = installedIds.length
    ? await db
        .select({ id: catalogRevision.id, pin: catalogRevision.pin })
        .from(catalogRevision)
        .where(inArray(catalogRevision.id, installedIds))
    : [];
  const installedPins = new Map(installedRevisions.map((revision) => [revision.id, revision.pin]));
  const items = rows.map(({ item, source, revision, install }) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    role: source.role,
    kind: source.kind,
    source: source.locator,
    path: item.path,
    latestPin: revision?.pin ?? null,
    installedPin: install ? (installedPins.get(install.revisionId) ?? null) : null,
    installed: Boolean(install),
    findings: (revision?.findings as Finding[] | undefined)?.length ?? null,
  }));
  return { items, total: counted?.total ?? 0 };
}

async function itemInTeam(teamId: number, itemId: number) {
  const [row] = await db
    .select({ item: catalogItem, source: catalogSource })
    .from(catalogItem)
    .innerJoin(catalogSource, eq(catalogSource.id, catalogItem.sourceId))
    .where(and(eq(catalogItem.id, itemId), eq(catalogSource.teamId, teamId)));
  if (!row) throw new HttpError(404, 'Catalog item not found');
  return row;
}

export async function inspectItem(teamId: number, itemId: number) {
  const { item, source } = await itemInTeam(teamId, itemId);
  if (!source.enabled) throw new HttpError(409, 'Catalog source is disabled');
  let result: ReturnType<typeof inspectSkillFiles>;
  let pin: string;
  if (source.kind === 'github-skills') {
    const found = await discoverGithubSkills(source.locator);
    const url = found.find((skill) => skill.subpath === item.path)?.url;
    if (!url) throw new HttpError(404, 'Skill is no longer present in the curated source');
    const inspected = await inspectGithubSkill(url);
    pin = inspected.pin;
    result = inspectSkillFiles(inspected.files);
  } else if (source.kind === 'npm-mcp') {
    const data = await fetchJson(npmUrl(source.locator));
    pin = String(data.version ?? '');
    result = await inspectNpm(source.locator, data);
  } else if (source.kind === 'pypi-mcp') {
    const data = await fetchJson(pypiUrl(source.locator));
    const info = data.info as Record<string, unknown>;
    pin = String(info.version ?? '');
    const releases = data.releases as Record<
      string,
      { filename?: string; url?: string; digests?: { sha256?: string } }[]
    >;
    const distribution = releases?.[pin]?.find(
      (file) => file.filename?.endsWith('.tar.gz') && file.url,
    );
    if (!distribution?.url || !distribution.digests?.sha256)
      throw new HttpError(502, 'PyPI package has no source archive and digest');
    const archive = await fetchArchive(distribution.url, 'files.pythonhosted.org');
    const digest = archiveHash(archive);
    if (digest !== distribution.digests.sha256)
      throw new HttpError(502, 'PyPI package digest does not match');
    const files = unpackTarGz(archive);
    result = inspectMcpPackage({
      name: source.locator,
      version: pin,
      license:
        typeof info.license_expression === 'string'
          ? info.license_expression
          : typeof info.license === 'string'
            ? info.license
            : null,
      integrity: digest,
      archiveSha256: digest,
      files,
      command: 'uvx',
      args: ['--offline', '--from', `${source.locator}==${pin}`, source.locator],
      environment: requiredEnv(files),
      permissions: observedPermissions(files),
      dependencies: Array.isArray(info.requires_dist) ? info.requires_dist.map(String) : [],
    });
    const archiveLicense = identifyLicense(
      files.map((file) => ({ path: file.path.split('/').slice(1).join('/'), bytes: file.bytes })),
    );
    if (archiveLicense && archiveLicense !== result.license)
      result.findings.push({
        code: 'license',
        severity: 'block',
        path: 'LICENSE',
        detail: 'Archive license differs from PyPI metadata',
      });
  } else {
    const repository = await inspectGithubRepository(source.locator);
    const manifestFile = repository.files.find((file) => file.path === 'package.json');
    if (!manifestFile)
      throw new HttpError(400, 'GitHub MCP repository needs a root package.json published on npm');
    const manifest = JSON.parse(manifestFile.bytes.toString('utf8')) as {
      name?: string;
      version?: string;
      license?: string;
    };
    if (!manifest.name || !manifest.version || !npmPattern.test(manifest.name))
      throw new HttpError(400, 'GitHub MCP package name and exact version are required');
    const metadata = await fetchJson(npmVersionUrl(manifest.name, manifest.version));
    if (metadata.name !== manifest.name || metadata.version !== manifest.version)
      throw new HttpError(502, 'GitHub manifest and npm release differ');
    result = await inspectNpm(manifest.name, metadata);
    const repoLicense = identifyLicense(repository.files, manifest.license);
    if (!repoLicense || repoLicense !== result.license)
      result.findings.push({
        code: 'license',
        severity: 'block',
        path: 'GitHub/LICENSE',
        detail: 'Repository and released package licenses differ or are unknown',
      });
    const repoScan = inspectMcpPackage({
      name: manifest.name,
      version: manifest.version,
      license: repoLicense,
      integrity: result.sha256,
      files: repository.files.map((file) => ({ ...file, executable: false })),
    });
    result.findings.push(...repoScan.findings);
    pin = `${repository.pin}@${manifest.version}`;
  }
  if (!pin || (source.kind.startsWith('github') && !/^[a-f0-9]{40}(?:@\d+\.\d+\.\d+)?$/i.test(pin)))
    throw new HttpError(502, 'Source did not provide an immutable pin');
  const [created] = await db
    .insert(catalogRevision)
    .values({
      itemId,
      pin,
      sha256: result.sha256,
      license: result.license,
      size: result.size,
      manifest: result.snapshot,
      findings: result.findings,
    })
    .onConflictDoNothing()
    .returning();
  const [revision] = created
    ? [created]
    : await db
        .select()
        .from(catalogRevision)
        .where(and(eq(catalogRevision.itemId, itemId), eq(catalogRevision.pin, pin)));
  if (revision.sha256 !== result.sha256)
    throw new HttpError(409, 'Pinned source content changed since inspection');
  await db
    .update(catalogItem)
    .set({
      latestRevisionId: revision.id,
      name: result.name && !hasPossibleSecret(result.name) ? result.name : item.name,
      description:
        result.description && !hasPossibleSecret(result.description)
          ? result.description
          : item.description,
    })
    .where(eq(catalogItem.id, itemId));
  return revision;
}

export async function previewItem(teamId: number, itemId: number) {
  const { item, source } = await itemInTeam(teamId, itemId);
  const revisions = await db
    .select()
    .from(catalogRevision)
    .where(eq(catalogRevision.itemId, itemId))
    .orderBy(sql`${catalogRevision.id} DESC`)
    .limit(20);
  const install = await db
    .select()
    .from(catalogInstall)
    .where(and(eq(catalogInstall.itemId, itemId), eq(catalogInstall.teamId, teamId)));
  return {
    item,
    source,
    latest: revisions.find((r) => r.id === item.latestRevisionId) ?? null,
    revisions: revisions.map((r) => ({
      id: r.id,
      pin: r.pin,
      sha256: r.sha256,
      createdAt: iso(r.createdAt),
    })),
    install: install[0] ?? null,
  };
}

function refs(snapshot: Snapshot) {
  return snapshot.files
    .filter((file) => file.path !== 'SKILL.md' && file.path.endsWith('.md'))
    .map((file) => ({
      path: file.path,
      bytes: Buffer.from(file.content, 'base64'),
      contentType: 'text/markdown',
    }));
}

async function targetAgents(teamId: number, scope: Scope): Promise<number[]> {
  if (scope.agentId && (scope.projectId || scope.roleId))
    throw new HttpError(400, 'Choose an agent or a project/role scope');
  if (scope.roleId) {
    const [role] = await db
      .select({ id: teamRole.id })
      .from(teamRole)
      .where(and(eq(teamRole.id, scope.roleId), eq(teamRole.teamId, teamId)));
    if (!role) throw new HttpError(400, 'Role is not in this team');
  }
  if (scope.agentId) {
    const [agent] = await db
      .select({ id: aiAgent.id })
      .from(aiAgent)
      .where(and(eq(aiAgent.id, scope.agentId), eq(aiAgent.teamId, teamId)));
    if (!agent) throw new HttpError(400, 'Agent is not in this team');
    return [agent.id];
  }
  if (!scope.projectId && !scope.roleId) return [];
  const rows = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(
      and(
        eq(aiAgent.teamId, teamId),
        eq(project.teamId, teamId),
        scope.projectId ? eq(project.id, scope.projectId) : undefined,
        scope.roleId ? eq(projectMember.roleId, scope.roleId) : undefined,
      ),
    );
  if (scope.projectId && !rows.length) {
    const [owned] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, scope.projectId), eq(project.teamId, teamId)));
    if (!owned) throw new HttpError(400, 'Project is not in this team');
  }
  return [...new Set(rows.map((r) => r.id))];
}

export async function adoptRevision(
  teamId: number,
  itemId: number,
  revisionId: number,
  scope: Scope,
  acknowledgeFindings = false,
) {
  const { item, source } = await itemInTeam(teamId, itemId);
  const [revision] = await db
    .select()
    .from(catalogRevision)
    .where(and(eq(catalogRevision.id, revisionId), eq(catalogRevision.itemId, itemId)));
  if (!revision) throw new HttpError(404, 'Catalog revision not found');
  const findings = revision.findings as Finding[];
  if (!inspectionPasses(findings)) throw new HttpError(409, 'Inspection has blocking findings');
  if (!source.enabled && revision.approved !== 'accepted')
    throw new HttpError(409, 'Catalog source is disabled');
  if (!acknowledgeFindings && findings.some((finding) => finding.severity === 'review'))
    throw new HttpError(409, 'Review findings must be acknowledged before adoption');
  const agents = await targetAgents(teamId, scope);
  const [existing] = await db
    .select()
    .from(catalogInstall)
    .where(and(eq(catalogInstall.teamId, teamId), eq(catalogInstall.itemId, itemId)));
  const snapshot = revision.manifest as Snapshot;
  let skillId = existing?.skillId ?? null;
  let mcpServerId = existing?.mcpServerId ?? null;
  if (source.kind === 'github-skills') {
    const sourceUrl = `${source.locator}/tree/${revision.pin}${item.path ? `/${item.path}` : ''}`;
    if (skillId)
      await replaceSkillFromFiles(skillId, teamId, {
        markdown: snapshot.markdown,
        refs: refs(snapshot),
      });
    else
      skillId = (
        await createSkillFromFiles(teamId, {
          name: item.name,
          description: item.description,
          markdown: snapshot.markdown,
          refs: refs(snapshot),
          source: 'github',
          sourceUrl,
        })
      ).id;
    await db
      .update(agentSkill)
      .set({ sourceUrl })
      .where(and(eq(agentSkill.id, skillId), eq(agentSkill.teamId, teamId)));
    if (agents.length)
      await db
        .insert(agentSkillLink)
        .values(agents.map((agentId) => ({ agentId, skillId: skillId! })))
        .onConflictDoNothing();
    for (const agentId of agents) await onTemplateRelevantChange(agentId, ['skills']);
  } else {
    if (process.env.AGENT_ISOLATION !== 'on')
      throw new HttpError(
        409,
        'Agent isolation must be enabled before an MCP server can be installed',
      );
    const input = {
      name: item.name,
      description: item.description,
      transport: 'stdio' as const,
      command: snapshot.command ?? '',
      args: snapshot.args ?? [],
      env: [],
    };
    if (mcpServerId) await updateMcpServer(mcpServerId, teamId, input);
    else mcpServerId = (await createMcpServer(teamId, input)).id;
    await db
      .update(agentMcpServer)
      .set({ catalogManaged: true })
      .where(and(eq(agentMcpServer.id, mcpServerId), eq(agentMcpServer.teamId, teamId)));
    if (agents.length)
      await db
        .insert(agentMcpServerLink)
        .values(agents.map((agentId) => ({ agentId, mcpServerId: mcpServerId! })))
        .onConflictDoNothing();
    for (const agentId of agents) await onTemplateRelevantChange(agentId, ['mcpServers']);
  }
  const [install] = await db
    .insert(catalogInstall)
    .values({
      itemId,
      teamId,
      revisionId,
      previousRevisionId: existing?.revisionId ?? null,
      skillId,
      mcpServerId,
      scope,
    })
    .onConflictDoUpdate({
      target: [catalogInstall.teamId, catalogInstall.itemId],
      set: {
        revisionId,
        previousRevisionId: existing?.revisionId ?? null,
        skillId,
        mcpServerId,
        scope,
        installedAt: new Date(),
      },
    })
    .returning();
  await db
    .update(catalogRevision)
    .set({ approved: 'accepted' })
    .where(eq(catalogRevision.id, revisionId));
  return install;
}

export async function rollbackItem(teamId: number, itemId: number) {
  await itemInTeam(teamId, itemId);
  const [installed] = await db
    .select()
    .from(catalogInstall)
    .where(and(eq(catalogInstall.teamId, teamId), eq(catalogInstall.itemId, itemId)));
  if (!installed?.previousRevisionId) throw new HttpError(409, 'No previous version to restore');
  return adoptRevision(
    teamId,
    itemId,
    installed.previousRevisionId,
    installed.scope as Scope,
    true,
  );
}

export async function diffRevisions(teamId: number, itemId: number, fromId: number, toId: number) {
  await itemInTeam(teamId, itemId);
  const revisions = await db
    .select()
    .from(catalogRevision)
    .where(and(eq(catalogRevision.itemId, itemId), inArray(catalogRevision.id, [fromId, toId])));
  const from = revisions.find((r) => r.id === fromId),
    to = revisions.find((r) => r.id === toId);
  if (!from || !to) throw new HttpError(404, 'Revision not found');
  const oldFiles = new Map((from.manifest as Snapshot).files.map((f) => [f.path, f.sha256]));
  const newFiles = new Map((to.manifest as Snapshot).files.map((f) => [f.path, f.sha256]));
  const beforeFiles = new Map((from.manifest as Snapshot).files.map((f) => [f.path, f]));
  const afterFiles = new Map((to.manifest as Snapshot).files.map((f) => [f.path, f]));
  const touched = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].filter(
    (path) => oldFiles.get(path) !== newFiles.get(path),
  );
  return {
    from: from.pin,
    to: to.pin,
    added: [...newFiles.keys()].filter((path) => !oldFiles.has(path)),
    removed: [...oldFiles.keys()].filter((path) => !newFiles.has(path)),
    changed: [...newFiles.keys()].filter(
      (path) => oldFiles.has(path) && oldFiles.get(path) !== newFiles.get(path),
    ),
    files: touched.map((path) => ({
      path,
      before: beforeFiles.get(path) ?? null,
      after: afterFiles.get(path) ?? null,
    })),
    markdownBefore: (from.manifest as Snapshot).markdown,
    markdownAfter: (to.manifest as Snapshot).markdown,
    findingsBefore: from.findings,
    findingsAfter: to.findings,
  };
}

export async function proposeItem(
  teamId: number,
  itemId: number,
  userId: string,
  agentId: number | null,
  reason: string,
) {
  const { source } = await itemInTeam(teamId, itemId);
  if (!source.enabled) throw new HttpError(409, 'Catalog source is disabled');
  if (source.kind !== 'github-skills')
    throw new HttpError(400, 'Only skills can be proposed with this tool');
  const [actor] = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(and(eq(aiAgent.teamId, teamId), eq(aiAgent.userId, userId)));
  if (actor && agentId && actor.id !== agentId)
    throw new HttpError(403, 'Agent may only suggest for itself');
  const proposedAgentId = actor?.id ?? agentId;
  if (proposedAgentId) await targetAgents(teamId, { agentId: proposedAgentId });
  const [row] = await db
    .insert(catalogProposal)
    .values({ teamId, itemId, proposedBy: userId, agentId: proposedAgentId, reason })
    .returning();
  return row;
}

export async function decideProposal(
  teamId: number,
  id: number,
  decision: 'accepted' | 'rejected',
  revisionId?: number,
  acknowledgeFindings = false,
) {
  const [proposal] = await db
    .select()
    .from(catalogProposal)
    .where(and(eq(catalogProposal.id, id), eq(catalogProposal.teamId, teamId)));
  if (!proposal) throw new HttpError(404, 'Proposal not found');
  if (proposal.state !== 'pending') throw new HttpError(409, 'Proposal already decided');
  if (decision === 'accepted') {
    if (!revisionId) throw new HttpError(400, 'An inspected revision is required');
    await adoptRevision(
      teamId,
      proposal.itemId,
      revisionId,
      proposal.agentId ? { agentId: proposal.agentId } : {},
      acknowledgeFindings,
    );
  }
  const [row] = await db
    .update(catalogProposal)
    .set({ state: decision })
    .where(eq(catalogProposal.id, id))
    .returning();
  return row;
}

export async function listProposals(teamId: number) {
  return db
    .select()
    .from(catalogProposal)
    .where(eq(catalogProposal.teamId, teamId))
    .orderBy(sql`${catalogProposal.id} DESC`)
    .limit(100);
}
