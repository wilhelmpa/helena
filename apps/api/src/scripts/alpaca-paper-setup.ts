import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { lstatSync, realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import type { PaperKeys } from '@helena/trading';

const LIVE_ROOT = '/srv/volition/source/plan';
const TEAM_ID = 1;
const AGENT_ID = 66;
const SOURCE_IDS = [43, 44];
export const PAPER_SETUP_DEFAULTS = {
  maxOrderValueUsd: 1000,
  maxPositionValueUsd: 2000,
  maxRiskPerTradeUsd: 50,
  dailyLossLimitUsd: 150,
  maxOpenPositions: 5,
  maxOrdersPerDay: 20,
  allowedSymbols: '',
  allowCrypto: false,
  tradingHalted: true,
};

interface PaperRead {
  active: boolean;
  positions: number;
  openOrders: number;
  marketOpen: boolean;
}

class SetupError extends Error {}

function check(value: unknown, code: string): asserts value {
  if (!value) throw new SetupError(code);
}

export async function setupAlpacaPaper(options: {
  mode: 'dry-run' | 'check' | 'apply';
  moduleRoot: string;
  // Only the private fixture tests inject a reader. The CLI always uses the GET-only client.
  readPaper?: (keys: PaperKeys) => Promise<PaperRead>;
}) {
  const load = createRequire(`${options.moduleRoot}/apps/api/package.json`);
  const {
    db,
    aiAgent,
    project,
    projectMember,
    integrationCredential,
    integrationCredentialGrant,
    agentTool,
    agentToolLink,
    openCredential,
  } = (await import(`${options.moduleRoot}/packages/db/src/index.ts`)) as typeof import('@repo/db');
  const { and, eq, inArray } = (await import(
    load.resolve('drizzle-orm')
  )) as typeof import('drizzle-orm');
  const { readKeys, readLimits, AlpacaPaperClient } = (await import(
    `${options.moduleRoot}/packages/trading/src/index.ts`
  )) as typeof import('@helena/trading');
  const { loadBuiltinPluginsForScripts } = (await import(
    load.resolve('#modules/project-blueprints/plugins')
  )) as typeof import('#modules/project-blueprints/plugins');
  const { createCredential, credentialValues } = (await import(
    load.resolve('#modules/agents/integrations/service')
  )) as typeof import('#modules/agents/integrations/service');
  const { replaceGrants } = (await import(
    load.resolve('#modules/agents/credentials/grants')
  )) as typeof import('#modules/agents/credentials/grants');
  const { recordOwnerChange } = (await import(
    load.resolve('#modules/agents/credentials/audit')
  )) as typeof import('#modules/agents/credentials/audit');
  const { createAgentTool, listAgentToolLinks, setAgentTools } = (await import(
    load.resolve('#modules/agents/tools/service')
  )) as typeof import('#modules/agents/tools/service');
  const { registries } = (await import(
    load.resolve('#shared/helena')
  )) as typeof import('#shared/helena');
  await loadBuiltinPluginsForScripts();

  const [trade] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.teamId, TEAM_ID), eq(project.key, 'TRADE')));
  const [agent] = await db
    .select({ id: aiAgent.id, userId: aiAgent.userId })
    .from(aiAgent)
    .where(
      and(
        eq(aiAgent.id, AGENT_ID),
        eq(aiAgent.teamId, TEAM_ID),
        eq(aiAgent.username, 'paper-trader-trade'),
        eq(aiAgent.template, false),
        eq(aiAgent.kind, 'external'),
      ),
    );
  check(trade && agent, 'exact-trade-agent-required');
  const memberships = await db
    .select({ projectId: projectMember.projectId })
    .from(projectMember)
    .where(eq(projectMember.userId, agent.userId));
  check(memberships.length === 1 && memberships[0]!.projectId === trade.id, 'agent-project-scope');
  const existing = await db
    .select({
      id: integrationCredential.id,
      projectId: integrationCredential.projectId,
      status: integrationCredential.status,
      statusDetail: integrationCredential.statusDetail,
    })
    .from(integrationCredential)
    .where(
      and(
        eq(integrationCredential.teamId, TEAM_ID),
        eq(integrationCredential.integrationKey, 'alpaca_paper'),
      ),
    );
  check(
    existing.length <= 1 && (existing[0]?.projectId == null || existing[0].projectId === trade.id),
    'paper-credential-scope',
  );
  const sources = await db
    .select()
    .from(integrationCredential)
    .where(inArray(integrationCredential.id, SOURCE_IDS));
  check(
    sources.length === 2 &&
      sources.every(
        (row) =>
          row.teamId === TEAM_ID &&
          row.integrationKey === 'api_key' &&
          (row.projectId === null || row.projectId === trade.id),
      ),
    'source-credential-scope',
  );
  const sourceGrants = await db
    .select({ id: integrationCredentialGrant.id })
    .from(integrationCredentialGrant)
    .where(inArray(integrationCredentialGrant.credentialId, SOURCE_IDS));
  check(sourceGrants.length === 0, 'source-credentials-have-grants');
  const sourceTools = await db
    .select({ id: agentTool.id })
    .from(agentTool)
    .where(inArray(agentTool.credentialId, SOURCE_IDS));
  check(sourceTools.length === 0, 'source-credentials-have-tools');
  const credentialId = existing[0]?.id;
  const grants = credentialId
    ? await db
        .select()
        .from(integrationCredentialGrant)
        .where(eq(integrationCredentialGrant.credentialId, credentialId))
    : [];
  check(
    grants.every(
      (row) => row.agentId === AGENT_ID && row.projectId === null && row.service === null,
    ),
    'foreign-paper-grant',
  );
  const configured = credentialId
    ? await db.select().from(agentTool).where(eq(agentTool.credentialId, credentialId))
    : [];
  check(
    configured.every((row) => row.teamId === TEAM_ID),
    'foreign-configured-tool-team',
  );
  const links = configured.length
    ? await db
        .select()
        .from(agentToolLink)
        .where(
          inArray(
            agentToolLink.agentToolId,
            configured.map((row) => row.id),
          ),
        )
    : [];
  check(
    links.every((row) => row.agentId === AGENT_ID),
    'foreign-native-tool-binding',
  );
  const currentLinks = await listAgentToolLinks(AGENT_ID);
  check(
    currentLinks.every(
      (row) => row.integrationKey !== 'alpaca_paper' || row.credentialId === credentialId,
    ),
    'other-paper-binding',
  );
  const toolKeys = registries.tools
    .list()
    .filter((tool) => tool.connector === 'alpaca_paper')
    .map((tool) => tool.name);
  check(
    toolKeys.includes('alpaca_paper_account') &&
      toolKeys.every(
        (key) =>
          key.startsWith('alpaca_paper_') ||
          key === 'trading_indikatoren' ||
          key === 'trading_signal_pruefen',
      ),
    'paper-tool-registry',
  );
  check(
    configured.every((tool) => toolKeys.includes(tool.toolKey)),
    'unknown-paper-tool-binding',
  );
  const values = credentialId
    ? await credentialValues(credentialId, TEAM_ID)
    : { ...PAPER_SETUP_DEFAULTS };
  check(values, 'paper-credential-unavailable');
  const { limits, missing } = readLimits(values);
  check(missing.length === 0, 'incomplete-paper-limits');
  check(limits.halted === true, 'paper-entry-halt-required');
  const missingTools = toolKeys.filter(
    (key) => !currentLinks.some((row) => row.toolKey === key && row.credentialId === credentialId),
  );
  const needsGrant = grants.length !== 1 || grants[0]?.access !== 'write';
  const verifiedStatus =
    'Paper account read verified; entries remain halted during strategy validation';
  const needsStatus = existing[0]?.status !== 'ok' || existing[0]?.statusDetail !== verifiedStatus;
  const summary = {
    mode: options.mode,
    projectId: trade.id,
    agentId: AGENT_ID,
    credentialId: credentialId ?? null,
    sourceCredentials: SOURCE_IDS,
    limits,
    missingTools,
    needsGrant,
    needsProjectScope: existing[0]?.projectId !== trade.id,
    needsStatus,
    ordersPlaced: 0,
  };
  if (options.mode === 'dry-run') return { ...summary, changed: false };
  if (!credentialId) {
    const value = (id: number) => {
      const decoded = JSON.parse(openCredential(sources.find((row) => row.id === id)!)) as {
        value?: unknown;
      };
      check(typeof decoded.value === 'string' && decoded.value.trim(), 'missing-source-value');
      return decoded.value.trim();
    };
    Object.assign(values, { keyId: value(43), secretKey: value(44) });
  }
  const readPaper =
    options.readPaper ??
    (async (keys: PaperKeys): Promise<PaperRead> => {
      const client = new AlpacaPaperClient(keys, async (url, init) => {
        check((init?.method ?? 'GET') === 'GET', 'setup-permits-only-get');
        return fetch(url, init);
      });
      const account = await client.account();
      const [positions, orders, clock] = await Promise.all([
        client.positions(),
        client.orders({ status: 'open', limit: 200 }),
        client.clock(),
      ]);
      return {
        active: account.status === 'ACTIVE' && !account.account_blocked && !account.trading_blocked,
        positions: positions.length,
        openOrders: orders.length,
        marketOpen: clock.is_open,
      };
    });
  const paper = await readPaper(readKeys(values));
  check(paper.active, 'paper-account-blocked');
  if (options.mode === 'check') return { ...summary, paper, changed: false };

  const id =
    credentialId ??
    (
      await createCredential(TEAM_ID, {
        integrationKey: 'alpaca_paper',
        label: 'Alpaca Paper · TRADE',
        credential: values,
      })
    ).id;
  if (!credentialId)
    await recordOwnerChange(
      TEAM_ID,
      id,
      { name: 'Owner via operator' },
      'created',
      'Paper setup from stored keys; no orders',
    );
  if (existing[0]?.projectId !== trade.id || needsStatus)
    await db
      .update(integrationCredential)
      .set({
        projectId: trade.id,
        status: 'ok',
        statusDetail: verifiedStatus,
        checkedAt: new Date(),
      })
      .where(and(eq(integrationCredential.id, id), eq(integrationCredential.teamId, TEAM_ID)));
  if (needsGrant) {
    await replaceGrants(
      { id, teamId: TEAM_ID, projectId: trade.id, projectKey: 'TRADE', services: [] },
      [{ agentId: AGENT_ID, access: 'write' }],
    );
    await recordOwnerChange(
      TEAM_ID,
      id,
      { name: 'Owner via operator' },
      'grants',
      'TRADE agent 66 only; sources retained without grants',
    );
  }
  if (missingTools.length) {
    const ids = currentLinks.map((row) => row.id);
    for (const toolKey of missingTools)
      ids.push(
        configured.find((row) => row.toolKey === toolKey)?.id ??
          (await createAgentTool(TEAM_ID, { toolKey, credentialId: id })).id,
      );
    await setAgentTools(AGENT_ID, TEAM_ID, ids);
  }
  return {
    ...summary,
    credentialId: id,
    paper,
    changed:
      !credentialId ||
      needsGrant ||
      missingTools.length > 0 ||
      existing[0]?.projectId !== trade.id ||
      needsStatus,
  };
}

if (import.meta.main) {
  const emit = (value: object) => process.stdout.write(`${JSON.stringify(value)}\n`);
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) console[level] = () => {};
  try {
    const args = process.argv.slice(2);
    check(
      args.every(
        (arg) =>
          ['--apply', '--check', '--dry-run'].includes(arg) ||
          /^--expected-head=[a-f0-9]{40}$/.test(arg) ||
          /^--expected-db-role=[a-zA-Z0-9_-]+$/.test(arg),
      ),
      'unknown-argument',
    );
    check(
      args.filter((arg) => ['--apply', '--check', '--dry-run'].includes(arg)).length <= 1,
      'ambiguous-mode',
    );
    check(
      process.getuid?.() === 0 || userInfo().username === 'volition-plan',
      'operator-user-required',
    );
    const staged = lstatSync(import.meta.path);
    check(staged.isFile() && staged.uid === 0 && (staged.mode & 0o022) === 0, 'root-staged-file');
    check(realpathSync(LIVE_ROOT) === LIVE_ROOT, 'canonical-source');
    const expectedHead = args.find((arg) => arg.startsWith('--expected-head='))?.slice(16);
    check(
      expectedHead &&
        execFileSync(
          'git',
          ['-c', `safe.directory=${LIVE_ROOT}`, '-C', LIVE_ROOT, 'rev-parse', 'HEAD'],
          { encoding: 'utf8', stdio: 'pipe' },
        ).trim() === expectedHead,
      'exact-live-head',
    );
    const url = new URL(process.env.DATABASE_URL ?? '');
    check(
      ['127.0.0.1', 'localhost'].includes(url.hostname) &&
        ['', '5432'].includes(url.port) &&
        url.pathname === '/itsaplan',
      'live-database-scope',
    );
    const { db } = await import(`${LIVE_ROOT}/packages/db/src/index.ts`);
    const load = createRequire(`${LIVE_ROOT}/apps/api/package.json`);
    const { sql } = await import(load.resolve('drizzle-orm'));
    const [scope] = await db.execute(sql`select current_database() as name, current_user as role`);
    check(
      scope?.name === 'itsaplan' &&
        scope.role === args.find((arg) => arg.startsWith('--expected-db-role='))?.slice(19),
      'exact-database-role',
    );
    emit(
      await setupAlpacaPaper({
        mode: args.includes('--apply') ? 'apply' : args.includes('--check') ? 'check' : 'dry-run',
        moduleRoot: LIVE_ROOT,
      }),
    );
    process.exit(0);
  } catch (error) {
    // Provider/database errors can contain secrets; output no external error message.
    emit({ failed: true, code: error instanceof SetupError ? error.message : 'setup-failed' });
    process.exit(1);
  }
}
