import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import { db, approvalRequest, helenaPolicyDecision, issue as issueTable, project } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';

// Opt-in operator acceptance in a dedicated private database, never the shared gate.
const root = '/home/wilhelmpa/agent-work/approval-display-acceptance';
const enabled = process.env.HELENA_APPROVAL_PROOF_TEST === '1';
describe.skipIf(!enabled)('approval display operator recovery', () => {
  it('archives only its own two cards and recovers every durable-write boundary', async () => {
    const url = new URL(process.env.DATABASE_URL!);
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.HELENA_TEST_DB_CLONE).toBe('0');
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe('65502');
    expect(url.pathname).toBe('/approval_display_test');
    await resetDb();
    const owner = await signUpTestUser({ name: 'Synthetic display proof' });
    const api = authedApi(owner.cookie);
    expect((await api.projects.post({ key: 'PROOF', name: 'Synthetic proof' })).status).toBe(201);
    const view = await api.projects({ projectKey: 'PROOF' }).get();
    const agent = await createAgent(api, 'PROOF', {
      name: 'Synthetic proof agent',
      username: 'proof-agent',
      kind: 'external',
    });
    const issue = await api.projects({ projectKey: 'PROOF' }).issues.post({
      columnId: view.data!.columns[0].id,
      title: 'Synthetic retained issue',
    });
    expect(agent.status).toBe(201);
    expect(issue.status).toBe(201);
    const [scope] = await db
      .select({ id: project.id, teamId: project.teamId })
      .from(project)
      .where(eq(project.key, 'PROOF'));
    expect((await api.projects({ projectKey: 'PROOF' }).autopilot.put({ level: 3 })).status).toBe(
      200,
    );
    const retained = await db
      .insert(approvalRequest)
      .values({
        projectId: scope!.id,
        agentId: agent.data!.agent.id,
        kind: 'delete',
        action: 'Unrelated synthetic request',
        details: 'Must survive all operator cleanups',
        status: 'rejected',
      })
      .returning();
    const retainedJson = JSON.stringify(retained);
    const retainedIssue = JSON.stringify(await db.select().from(issueTable));
    const activity = async () =>
      JSON.stringify(
        await db.execute(sql`
      select (select count(*)::int from agent_run) as runs,
        (select count(*)::int from agent_chat_message) as chats,
        (select count(*)::int from notification) as notifications,
        (select count(*)::int from helena_policy_decision) as decisions`),
      );
    const originalActivity = await activity();
    const revision = async () => {
      const [row] = await db.execute<{ rev: number }>(sql`
        select rev::int from revision where scope = ${'approvals:' + scope!.teamId}`);
      return row?.rev ?? 0;
    };

    const makeRun = () => {
      const runId = randomUUID().replaceAll('-', '');
      const directory = mkdtempSync(join(root, 'proof-acceptance-'));
      const file = join(directory, `approval-display-${runId}.json`);
      const archive = join(directory, `approval-display-${runId}.archive.json`);
      const run = async (
        mode: string,
        failure?: string,
        rejectedPhase?: string,
        overrides: Record<string, string> = {},
        extra: string[] = [],
      ) => {
        const args: Record<string, string> = {
          'expected-head': '0'.repeat(40),
          'database-name': 'approval_display_test',
          'database-role': decodeURIComponent(url.username),
          'run-id': runId,
          'manifest-dir': directory,
          'project-id': String(scope!.id),
          'agent-id': String(agent.data!.agent.id),
          'issue-id': String(issue.data!.id),
          'private-test-root': root,
          ...overrides,
        };
        const child = Bun.spawn(
          [
            process.execPath,
            join(root, 'apps/api/src/scripts/approval-display-proof.ts'),
            mode,
            ...Object.entries(args).map(([key, value]) => `--${key}=${value}`),
            ...extra,
          ],
          {
            cwd: root,
            env: { ...process.env, HELENA_DISPLAY_PROOF_FAILURE: failure ?? '' },
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const [stdout, stderr, exit] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect(stderr).toBe('');
        const result = JSON.parse(stdout.trim().split('\n').at(-1)!);
        const phase = rejectedPhase ?? (failure ? `injected-${failure}` : undefined);
        const expectedSuccess = !phase;
        expect(result, stdout).toMatchObject(
          phase
            ? { success: false, phase }
            : {
                success: true,
                mode,
                projectId: scope!.id,
                agentId: agent.data!.agent.id,
                issueId: issue.data!.id,
                displayOnly: true,
                provesActionOrHttpAuthentication: false,
              },
        );
        expect(exit).toBe(expectedSuccess ? 0 : 1);
        expect(result.success).toBe(expectedSuccess);
        return result;
      };
      return { run, file, archive, directory };
    };

    const clean = makeRun();
    const before = await revision();
    await clean.run('dry-run');
    expect(existsSync(clean.file)).toBe(false);
    expect(await revision()).toBe(before);
    await clean.run('apply');
    expect(statSync(clean.file).mode & 0o777).toBe(0o600);
    expect(await revision()).toBe(before + 2);
    await clean.run('verify');
    expect(await revision()).toBe(before + 2);
    await clean.run('apply', undefined, 'unused-marker');
    await clean.run('cleanup');
    expect(await revision()).toBe(before + 4);
    const archive = readFileSync(clean.archive, 'utf8');
    expect(JSON.parse(archive).cards).toHaveLength(2);
    expect(statSync(clean.archive).mode & 0o777).toBe(0o600);
    await clean.run('cleanup');
    expect(await revision()).toBe(before + 4);
    expect(readFileSync(clean.archive, 'utf8')).toBe(archive);

    for (const boundary of [
      'after-prepared-manifest',
      'after-insert-manifest',
      'after-insert-commit',
    ]) {
      const recovery = makeRun();
      const before = await revision();
      await recovery.run('apply', boundary);
      const committed = boundary === 'after-insert-commit';
      expect(await db.select().from(approvalRequest)).toHaveLength(committed ? 3 : 1);
      expect(await revision()).toBe(before + (committed ? 2 : 0));
      await recovery.run('cleanup');
      await recovery.run('cleanup');
      expect(await revision()).toBe(before + (committed ? 4 : 0));
      expect(JSON.parse(readFileSync(recovery.file, 'utf8')).state).toBe('cleaned');
      if (boundary === 'after-insert-manifest') {
        const archived = JSON.parse(readFileSync(recovery.archive, 'utf8'));
        expect(archived.cards).toEqual([]);
        expect(archived.absentCards).toHaveLength(2);
      }
    }

    for (const boundary of ['after-archive-write', 'before-delete-commit', 'after-delete-commit']) {
      const recovery = makeRun();
      await recovery.run('apply');
      const before = await revision();
      await recovery.run('cleanup', boundary);
      const committed = boundary === 'after-delete-commit';
      expect(await db.select().from(approvalRequest)).toHaveLength(committed ? 1 : 3);
      expect(await revision()).toBe(before + (committed ? 2 : 0));
      const archived = readFileSync(recovery.archive, 'utf8');
      await recovery.run('cleanup');
      await recovery.run('cleanup');
      expect(await revision()).toBe(before + 2);
      expect(readFileSync(recovery.archive, 'utf8')).toBe(archived);
      expect(JSON.parse(readFileSync(recovery.file, 'utf8')).state).toBe('cleaned');
    }

    const altered = makeRun();
    await altered.run('apply');
    const saved = readFileSync(altered.file, 'utf8');
    const tampered = JSON.parse(saved);
    tampered.cards[0].sha256 = '0'.repeat(64);
    writeFileSync(altered.file, JSON.stringify(tampered));
    await altered.run('cleanup', undefined, 'unchanged-owned-card');
    expect(await db.select().from(approvalRequest)).toHaveLength(3);
    // Restore only our own private manifest for the normal verified cleanup.
    writeFileSync(altered.file, saved);
    await altered.run('cleanup');

    const refused = makeRun();
    for (const [key, value, phase] of [
      ['expected-head', '1'.repeat(40), 'exact-reviewed-head'],
      ['database-name', 'wrong_test', 'reviewed-database-and-role'],
      ['database-role', 'wrong_role', 'reviewed-database-and-role'],
      ['private-test-root', root + '-other', 'private-scope'],
      ['issue-id', '2147483647', 'existing-project-agent-issue-scope'],
      ['project-id', '0', 'metadata-id'],
      ['run-id', 'invalid', 'explicit-run-id'],
    ])
      await refused.run('apply', undefined, phase, { [key!]: value! });
    await refused.run('apply', undefined, 'unique-known-arguments', {}, ['--agent-id=1']);
    await refused.run('apply', undefined, 'unique-known-arguments', {}, ['--unknown=yes']);
    await refused.run('apply', 'unknown', 'private-failure-injection');
    expect(existsSync(refused.file)).toBe(false);

    const changed = makeRun();
    await changed.run('apply');
    const original = readFileSync(changed.file, 'utf8');
    const mismatched = JSON.parse(original);
    mismatched.projectId++;
    writeFileSync(changed.file, JSON.stringify(mismatched));
    await changed.run('cleanup', undefined, 'exact-manifest-scope');
    writeFileSync(changed.file, original);
    const cardId = mismatched.cards[0].id;
    const [card] = await db.select().from(approvalRequest).where(eq(approvalRequest.id, cardId));
    await db
      .update(approvalRequest)
      .set({ details: 'Changed private fixture' })
      .where(eq(approvalRequest.id, cardId));
    await changed.run('cleanup', undefined, 'unchanged-owned-card');
    expect(await db.select().from(approvalRequest)).toHaveLength(3);
    expect(existsSync(changed.archive)).toBe(false);
    await db
      .update(approvalRequest)
      .set({ details: card!.details })
      .where(eq(approvalRequest.id, cardId));
    const [reference] = await db
      .insert(helenaPolicyDecision)
      .values({
        adapter: 'synthetic-proof',
        category: 'delete',
        outcome: 'needs-approval',
        level: 3,
        levelSource: 'project',
        reason: 'hard-block',
        approvalId: cardId,
      })
      .returning();
    await changed.run('cleanup', undefined, 'no-dependent-rows');
    expect(existsSync(changed.archive)).toBe(false);
    expect(
      await db
        .select()
        .from(helenaPolicyDecision)
        .where(eq(helenaPolicyDecision.id, reference!.id)),
    ).toEqual([reference!]);
    await db.delete(helenaPolicyDecision).where(eq(helenaPolicyDecision.id, reference!.id));
    await changed.run('cleanup');

    const privateFiles = makeRun();
    chmodSync(privateFiles.directory, 0o755);
    await privateFiles.run('apply', undefined, 'private-directory');
    chmodSync(privateFiles.directory, 0o700);
    await privateFiles.run('apply');
    chmodSync(privateFiles.file, 0o644);
    await privateFiles.run('cleanup', undefined, 'private-regular-file');
    chmodSync(privateFiles.file, 0o600);
    renameSync(privateFiles.file, privateFiles.file + '.original');
    symlinkSync(privateFiles.file + '.original', privateFiles.file);
    await privateFiles.run('cleanup', undefined, 'private-regular-file');
    renameSync(privateFiles.file, privateFiles.file + '.rejected-symlink');
    renameSync(privateFiles.file + '.original', privateFiles.file);
    linkSync(privateFiles.file, privateFiles.file + '.linked');
    await privateFiles.run('cleanup', undefined, 'private-regular-file');
    const privateManifest = readFileSync(privateFiles.file, 'utf8');
    renameSync(privateFiles.file, privateFiles.file + '.rejected-hardlink');
    writeFileSync(privateFiles.file, privateManifest, { mode: 0o600, flag: 'wx' });
    await privateFiles.run('cleanup', 'after-archive-write');
    const originalArchive = readFileSync(privateFiles.archive, 'utf8');
    writeFileSync(privateFiles.archive, 'changed');
    await privateFiles.run('cleanup', undefined, 'unchanged-archive');
    expect(await db.select().from(approvalRequest)).toHaveLength(3);
    writeFileSync(privateFiles.archive, originalArchive);
    await privateFiles.run('cleanup');
    writeFileSync(privateFiles.archive, 'changed after cleanup');
    await privateFiles.run('cleanup', undefined, 'durable-archive');
    writeFileSync(privateFiles.archive, originalArchive);
    await privateFiles.run('cleanup');

    expect(JSON.stringify(await db.select().from(approvalRequest))).toBe(retainedJson);
    expect(JSON.stringify(await db.select().from(issueTable))).toBe(retainedIssue);
    expect(await activity()).toBe(originalActivity);
  }, 180_000);
});
