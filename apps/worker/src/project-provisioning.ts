import {
  helenaSchedule,
  aiAgent,
  db,
  projectDeprovisioningJob,
  projectMember,
  projectProvisioningJob,
  projectView,
  projectViewFolder,
} from '@repo/db';
import { and, asc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { equalJitterBackoffMs } from './backoff';
import { workerConfig } from './config';

interface ClaimedProvisioningJob {
  id: string;
  projectId: number;
  teamId: number;
  key: string;
  name: string;
  description: string;
  requestedResources: string[];
  attempts: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface ClaimedDeprovisioningJob {
  id: string;
  projectId: number;
  project: {
    id: number;
    teamId: number;
    key: string;
    name: string;
    description: string;
  };
  requestedResources: string[];
  attempts: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface ProvisionedResource {
  kind: string;
  id: string;
  url?: string;
}

interface ProvisioningResult {
  resources: ProvisionedResource[];
  warnings?: string[];
}

export async function processProjectProvisioning(): Promise<void> {
  const config = workerConfig();
  if (!config.projectProvisioningUrl || !config.projectProvisioningToken) return;
  const [provisioning, deprovisioning] = await Promise.all([
    claimProvisioningJobs(),
    claimDeprovisioningJobs(),
  ]);
  await Promise.all([
    ...provisioning.map((job) => deliverProvisioningJob(job)),
    ...deprovisioning.map((job) => deliverDeprovisioningJob(job)),
  ]);
}

// A provisioning job is one row per live project and goes with it. A deprovisioning
// row outlives its project, so a finished one is removed after 30 days.
export async function pruneFinishedDeprovisioningJobs(): Promise<number> {
  const removed = await db
    .delete(projectDeprovisioningJob)
    .where(
      and(
        eq(projectDeprovisioningJob.status, 'succeeded'),
        lt(projectDeprovisioningJob.completedAt, sql`now() - interval '30 days'`),
      ),
    )
    .returning({ id: projectDeprovisioningJob.id });
  return removed.length;
}

async function claimProvisioningJobs(): Promise<ClaimedProvisioningJob[]> {
  const { batchSize, leaseSeconds, maxAttempts, projectProvisioningTimeoutMs } = workerConfig();
  const provisioningLeaseSeconds = Math.max(
    leaseSeconds,
    Math.ceil(projectProvisioningTimeoutMs / 1000) + 30,
  );
  await db.execute(sql`
    UPDATE project_provisioning_job
       SET status = 'failed',
           last_error = 'Worker lease expired too many times',
           updated_at = now()
     WHERE status = 'pending'
       AND attempts >= ${maxAttempts}
       AND next_attempt_at <= now()
  `);
  const rows = await db.execute(sql`
    UPDATE project_provisioning_job j
    SET attempts = j.attempts + 1,
        next_attempt_at = now() + make_interval(secs => ${provisioningLeaseSeconds}),
        updated_at = date_trunc('milliseconds', now())
    WHERE j.id IN (
      SELECT id FROM project_provisioning_job
      WHERE status = 'pending'
        AND attempts < ${maxAttempts}
        AND next_attempt_at <= now()
      ORDER BY next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${batchSize}
    )
    RETURNING
      j.id,
      j.project_id AS "projectId",
      j.requested_resources AS "requestedResources",
      j.attempts,
      j.created_at AS "createdAt",
      j.updated_at AS "updatedAt",
      (SELECT team_id FROM project p WHERE p.id = j.project_id) AS "teamId",
      (SELECT key FROM project p WHERE p.id = j.project_id) AS key,
      (SELECT name FROM project p WHERE p.id = j.project_id) AS name,
      (SELECT description FROM project p WHERE p.id = j.project_id) AS description
  `);
  return rows as unknown as ClaimedProvisioningJob[];
}

async function claimDeprovisioningJobs(): Promise<ClaimedDeprovisioningJob[]> {
  const { batchSize, leaseSeconds, maxAttempts, projectProvisioningTimeoutMs } = workerConfig();
  const provisioningLeaseSeconds = Math.max(
    leaseSeconds,
    Math.ceil(projectProvisioningTimeoutMs / 1000) + 30,
  );
  await db.execute(sql`
    UPDATE project_deprovisioning_job
       SET status = 'failed',
           last_error = 'Worker lease expired too many times',
           updated_at = now()
     WHERE status = 'pending'
       AND attempts >= ${maxAttempts}
       AND next_attempt_at <= now()
  `);
  const rows = await db.execute(sql`
    UPDATE project_deprovisioning_job j
    SET attempts = j.attempts + 1,
        next_attempt_at = now() + make_interval(secs => ${provisioningLeaseSeconds}),
        updated_at = date_trunc('milliseconds', now())
    WHERE j.id IN (
      SELECT id FROM project_deprovisioning_job
      WHERE status = 'pending'
        AND attempts < ${maxAttempts}
        AND next_attempt_at <= now()
      ORDER BY next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${batchSize}
    )
    RETURNING
      j.id,
      j.project_id AS "projectId",
      j.project,
      j.requested_resources AS "requestedResources",
      j.attempts,
      j.created_at AS "createdAt",
      j.updated_at AS "updatedAt"
  `);
  return rows as unknown as ClaimedDeprovisioningJob[];
}

async function deliverProvisioningJob(job: ClaimedProvisioningJob): Promise<void> {
  const config = workerConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.projectProvisioningTimeoutMs);
  try {
    const requestedResources = withCoordinator(job.requestedResources);
    const boards = await requestedBoards(job);
    const agents = (await projectAgentIds([job.projectId])).get(job.projectId) ?? [];
    const areas = await projectAreas(job.projectId);
    const response = await fetch(config.projectProvisioningUrl!, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.projectProvisioningToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': job.id,
        'X-Itsaplan-Event': 'project.provision',
        'X-Itsaplan-Event-Id': job.id,
      },
      body: JSON.stringify({
        eventId: job.id,
        eventType: 'project.provision',
        project: {
          id: job.projectId,
          key: job.key,
          name: job.name,
          description: job.description,
          teamId: job.teamId,
        },
        requestedResources,
        ...(boards.length ? { boards } : {}),
        ...(agents.length ? { agents } : {}),
        ...(areas.length ? { areas } : {}),
        // The links the provisioning writes for the agents (PROJECT.json) use it.
        ...(config.publicOrigin ? { publicUrl: `${config.publicOrigin}/` } : {}),
        createdAt: new Date(job.createdAt).toISOString(),
      }),
    });
    if (response.ok) {
      const raw = await readBoundedBody(response, 256 * 1024);
      const result = sanitizeResult(parseJson(raw), new Set(requestedResources));
      await db
        .update(projectProvisioningJob)
        .set({
          status: 'succeeded',
          lastError: null,
          result,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(currentClaim(job));
      return;
    }
    await recordFailure(job, `HTTP ${response.status}`, isRetryableStatus(response.status));
  } catch (error) {
    await recordFailure(job, safeRequestError(error), true);
  } finally {
    clearTimeout(timeout);
  }
}

// The schedules of a deleted project would keep firing. They are switched off before the
// job reaches provisioning; the engine drops the fires of a schedule that is off, and its
// maintenance removes the schedule from the engine.
async function stopProjectSchedules(job: ClaimedDeprovisioningJob): Promise<void> {
  await db
    .update(helenaSchedule)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(helenaSchedule.projectId, job.projectId));
}

async function deliverDeprovisioningJob(job: ClaimedDeprovisioningJob): Promise<void> {
  const config = workerConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.projectProvisioningTimeoutMs);
  try {
    await stopProjectSchedules(job);
    const response = await fetch(config.projectProvisioningUrl!, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.projectProvisioningToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': job.id,
        'X-Itsaplan-Event': 'project.deprovision',
        'X-Itsaplan-Event-Id': job.id,
      },
      body: JSON.stringify({
        eventId: job.id,
        eventType: 'project.deprovision',
        project: job.project,
        requestedResources: job.requestedResources,
        createdAt: new Date(job.createdAt).toISOString(),
      }),
    });
    if (response.ok) {
      const raw = await readBoundedBody(response, 256 * 1024);
      const result = sanitizeResult(parseJson(raw), new Set(job.requestedResources));
      await db
        .update(projectDeprovisioningJob)
        .set({
          status: 'succeeded',
          lastError: null,
          result,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(currentDeprovisioningClaim(job));
      return;
    }
    await recordDeprovisioningFailure(
      job,
      `HTTP ${response.status}`,
      isRetryableStatus(response.status),
    );
  } catch (error) {
    await recordDeprovisioningFailure(job, safeRequestError(error), true);
  } finally {
    clearTimeout(timeout);
  }
}

function withCoordinator(resources: readonly string[]): string[] {
  if (resources.includes('coordinator')) return [...resources];
  const browser = resources.indexOf('browser');
  return browser < 0
    ? [...resources, 'coordinator']
    : [...resources.slice(0, browser), 'coordinator', ...resources.slice(browser)];
}

// The external agents of each project that run in a runtime of their own (Hermes, Claude
// Code or Codex), by project id. The Home agent and the coordinators have theirs already,
// and an agent that works in several projects has none: the runner claims an agent's runs
// from all of its projects with one working directory. The api checks the same rule before
// it issues an agent's key, and names the runtime.
export async function projectAgentIds(projectIds?: number[]): Promise<Map<number, number[]>> {
  if (projectIds?.length === 0) return new Map();
  const rows = await db
    .select({ projectId: projectMember.projectId, agentId: aiAgent.id })
    .from(aiAgent)
    .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
    .where(
      and(
        eq(aiAgent.kind, 'external'),
        ne(aiAgent.username, 'master'),
        sql`${aiAgent.username} !~ '^hermes-[a-z0-9_-]+-coordinator$'`,
        sql`(select count(*) from ${projectMember} where ${projectMember.userId} = ${aiAgent.userId}) = 1`,
        projectIds ? inArray(projectMember.projectId, projectIds) : undefined,
      ),
    )
    .orderBy(asc(aiAgent.id));
  const byProject = new Map<number, number[]>();
  for (const { projectId, agentId } of rows) {
    byProject.set(projectId, [...(byProject.get(projectId) ?? []), agentId]);
  }
  return byProject;
}

// Every area of the project with its folder. The integration service creates the
// folders of new areas, moves those whose folder changed and moves the folders of an
// area missing from the list to the trash.
async function projectAreas(projectId: number) {
  return db
    .select({
      id: projectViewFolder.id,
      name: projectViewFolder.name,
      folder: projectViewFolder.folder,
    })
    .from(projectViewFolder)
    .where(eq(projectViewFolder.projectId, projectId))
    .orderBy(asc(projectViewFolder.id));
}

async function requestedBoards(job: ClaimedProvisioningJob) {
  const ids = [
    ...new Set(
      job.requestedResources.flatMap((resource) => {
        const match = /^board:([1-9][0-9]{0,9})$/.exec(resource);
        const id = match ? Number(match[1]) : 0;
        return Number.isSafeInteger(id) && id <= 2_147_483_647 ? [id] : [];
      }),
    ),
  ].slice(0, 200);
  if (!ids.length) return [];
  const rows = await db
    .select({
      id: projectView.id,
      name: projectView.name,
      folderId: projectViewFolder.id,
      folderName: projectViewFolder.name,
    })
    .from(projectView)
    .leftJoin(projectViewFolder, eq(projectViewFolder.id, projectView.folderId))
    .where(and(eq(projectView.projectId, job.projectId), inArray(projectView.id, ids)));
  return rows.map((row) => ({
    resource: `board:${row.id}`,
    id: row.id,
    name: row.name.slice(0, 100),
    slug: resourceSlug(row.name),
    folder:
      row.folderId == null || row.folderName == null
        ? null
        : {
            id: row.folderId,
            name: row.folderName.slice(0, 100),
            slug: resourceSlug(row.folderName),
          },
  }));
}

function resourceSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32)
      .replace(/-+$/g, '') || 'board'
  );
}

async function recordFailure(
  job: ClaimedProvisioningJob,
  error: string,
  retryable: boolean,
): Promise<void> {
  const config = workerConfig();
  const retry = retryable && job.attempts < config.maxAttempts;
  const delaySeconds = Math.max(1, Math.ceil(equalJitterBackoffMs(job.attempts) / 1000));
  await db
    .update(projectProvisioningJob)
    .set({
      status: retry ? 'pending' : 'failed',
      nextAttemptAt: retry ? sql`now() + make_interval(secs => ${delaySeconds})` : new Date(),
      lastError: error.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(currentClaim(job));
}

async function recordDeprovisioningFailure(
  job: ClaimedDeprovisioningJob,
  error: string,
  retryable: boolean,
): Promise<void> {
  const config = workerConfig();
  const retry = retryable && job.attempts < config.maxAttempts;
  const delaySeconds = Math.max(1, Math.ceil(equalJitterBackoffMs(job.attempts) / 1000));
  await db
    .update(projectDeprovisioningJob)
    .set({
      status: retry ? 'pending' : 'failed',
      nextAttemptAt: retry ? sql`now() + make_interval(secs => ${delaySeconds})` : new Date(),
      lastError: error.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(currentDeprovisioningClaim(job));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function currentClaim(job: ClaimedProvisioningJob) {
  return and(
    eq(projectProvisioningJob.id, job.id),
    eq(projectProvisioningJob.status, 'pending'),
    eq(projectProvisioningJob.attempts, job.attempts),
    eq(projectProvisioningJob.updatedAt, new Date(job.updatedAt)),
  );
}

function currentDeprovisioningClaim(job: ClaimedDeprovisioningJob) {
  return and(
    eq(projectDeprovisioningJob.id, job.id),
    eq(projectDeprovisioningJob.status, 'pending'),
    eq(projectDeprovisioningJob.attempts, job.attempts),
    eq(projectDeprovisioningJob.updatedAt, new Date(job.updatedAt)),
  );
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Response too large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error('Response too large');
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function safeRequestError(error: unknown): string {
  if (error instanceof Error && error.message === 'Response too large') return error.message;
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'request timed out';
  }
  return 'request failed';
}

function sanitizeResult(
  value: unknown,
  requestedResources: ReadonlySet<string>,
): ProvisioningResult | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as { resources?: unknown; warnings?: unknown };
  if (!Array.isArray(input.resources)) return null;
  const resources = input.resources.slice(0, 512).flatMap((candidate): ProvisionedResource[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const row = candidate as { kind?: unknown; id?: unknown; url?: unknown };
    if (typeof row.kind !== 'string' || typeof row.id !== 'string') return [];
    const kind = row.kind.trim().slice(0, 100);
    const id = row.id.trim().slice(0, 500);
    if (!kind || !id || !isAllowedResultKind(kind, requestedResources)) return [];
    const resource: ProvisionedResource = {
      kind,
      id,
    };
    if (typeof row.url === 'string') {
      const url = sanitizeResourceUrl(kind, row.url);
      if (url) resource.url = url;
    }
    return [resource];
  });
  const warnings = Array.isArray(input.warnings)
    ? input.warnings
        .slice(0, 20)
        .filter((warning): warning is string => typeof warning === 'string')
        .map((w) => w.slice(0, 500))
    : undefined;
  return warnings?.length ? { resources, warnings } : { resources };
}

function isAllowedResultKind(kind: string, requestedResources: ReadonlySet<string>): boolean {
  if (requestedResources.has(kind)) return true;
  const boardFiles = /^board:([1-9][0-9]{0,9}):files$/.exec(kind);
  return boardFiles ? requestedResources.has(`board:${boardFiles[1]}`) : false;
}

function sanitizeResourceUrl(kind: string, value: string): string | null {
  if (value.length > 2000) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      return null;
    }
    // These two UI deep links require one non-secret path parameter. All other
    // query fields are discarded so access tokens cannot be persisted by mistake.
    const board = /^board:([1-9][0-9]{0,9})(:files)?$/.exec(kind);
    const queryKey =
      kind === 'workspace' || (board && !board[2])
        ? 'folder'
        : kind === 'files' || board?.[2] === ':files'
          ? 'dir'
          : kind === 'terminal'
            ? 'arg'
            : null;
    const deepPath = queryKey ? url.searchParams.get(queryKey) : null;
    const browserRoute =
      kind === 'browser'
        ? /^\/browser\/projects\/([a-z0-9][a-z0-9-]{0,31})\/vnc\.html$/.exec(url.pathname)
        : null;
    const browserPath = browserRoute ? url.searchParams.get('path') : null;
    const validBrowserPath =
      browserRoute !== null &&
      browserPath === `browser/projects/${browserRoute[1]}/websockify` &&
      url.searchParams.get('autoconnect') === '1' &&
      url.searchParams.get('resize') === 'remote';
    url.search = '';
    const validDeepPath = board
      ? board[2] === ':files'
        ? new RegExp(`^/Projects/[a-z0-9][a-z0-9_-]{0,127}/Boards/board-${board[1]}$`, 'i').test(
            deepPath ?? '',
          )
        : new RegExp(`^/projects/[a-z0-9][a-z0-9_-]{0,127}/boards/board-${board[1]}$`, 'i').test(
            deepPath ?? '',
          )
      : kind === 'workspace'
        ? /^\/projects\/[a-z0-9][a-z0-9_-]{0,127}$/i.test(deepPath ?? '')
        : kind === 'files'
          ? /^\/Projects\/[a-z0-9][a-z0-9_-]{0,127}$/i.test(deepPath ?? '')
          : kind === 'terminal'
            ? /^[a-z0-9][a-z0-9_-]{0,63}$/.test(deepPath ?? '')
            : false;
    if (queryKey && deepPath && validDeepPath) {
      url.searchParams.set(queryKey, deepPath);
    }
    if (validBrowserPath) {
      url.searchParams.set('autoconnect', '1');
      url.searchParams.set('resize', 'remote');
      url.searchParams.set('path', browserPath);
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}
